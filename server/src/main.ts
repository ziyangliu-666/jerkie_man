import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room.js';
import { log } from './logger.js';
import {
  C2S_MESSAGE_SCHEMA,
  S2C_SNAPSHOT_SCHEMA,
  S2C_ERROR_SCHEMA,
  S2C_WELCOME_SCHEMA,
  S2C_WORLD_INIT_SCHEMA, // 静态世界初始化消息
  S2C_EVENT_SCHEMA, // 游戏化增强: 事件消息
  S2C_PONG_SCHEMA, // Day5: Pong 消息
  S2C_PROFILE_SCHEMA, // P1-1: Profile 消息
  S2C_RAID_RESULT_SCHEMA, // 新增: 战局结果消息
  S2C_COMBAT_EVENT_SCHEMA, // 新增: 战斗事件消息
  getWeaponDef, // 新增: 用于重置武器运行时状态
  type C2S_MESSAGE,
} from '@jerkie-man/shared';

// 支持从环境变量读取端口和主机地址（CI友好）
const PORT = Number(process.env.PORT) || 18723;
const HOST = process.env.HOST || '0.0.0.0'; // 默认监听所有网络接口
const TICK_INTERVAL_MS = 50; // 20Hz
const SNAPSHOT_INTERVAL_MS = 100; // 10Hz

const wss = new WebSocketServer({ host: HOST, port: PORT });
// P1-1 修复: 支持通过环境变量 SEED 注入 seed（用于调试/测试）
const room = new Room('local', process.env.SEED ? parseInt(process.env.SEED, 10) : undefined);

// 处理server级别的错误
wss.on('error', (error: Error) => {
  log('SERVER_ERROR', {
    room: room.id,
    tick: room.tick,
    error: error.message,
  });
});

// 存储每个连接的玩家ID
const connections = new Map<WebSocket, string>();
// 新增: 存储每个连接的账号ID（用于 Profile 持久化）
const wsToAccountId = new Map<WebSocket, string>();
// 新增: playerId -> accountId 映射（让 room/profile 能查）
const playerIdToAccountId = new Map<string, string>();

// 输入队列（按playerId组织）
// 队列保护：最大长度32，超过时丢弃旧的
const INPUT_QUEUE_MAX_LENGTH = 32;
const inputQueues = new Map<string, Array<{ input: C2S_MESSAGE & { type: 'C2S_INPUT' }; ws: WebSocket }>>();
let lastQueueWarnTime = 0;

// P2-3: Pickup 队列（入队列 tick 处理，确保移动和拾取对齐）
// 新增: type: 'auto' 表示服务端自动选最近目标
type PickupReq = 
  | { type: 'world'; wid: string; ws: WebSocket }
  | { type: 'bag'; bid: string; ws: WebSocket }
  | { type: 'auto'; ws: WebSocket };
const pickupQueues = new Map<string, PickupReq[]>();

// P1-1 修复: lastProfileSentTick 移至模块级，避免每 tick 重新创建导致重复发送
const lastProfileSentTick = new Map<string, number>();
// 新增: 记录玩家撤离时的背包物品数（用于判断"刚完成撤离"）
const lastExtractedInventoryCount = new Map<string, number>();

// 辅助函数：发送Profile消息
function sendProfile(ws: WebSocket, accountId: string, phase?: 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT'): void {
  const profile = room.profileManager.getProfileData(accountId);
  const profilePhase = phase ?? (profile.displayName === null ? 'NAME' : 'HIDEOUT');
  ws.send(
    JSON.stringify(
      S2C_PROFILE_SCHEMA.parse({
        type: 'S2C_PROFILE',
        accountId: accountId,
        displayName: profile.displayName,
        phase: profilePhase,
        money: profile.money,
        stash: profile.stash,
        prep: profile.prep,
        bagCap: profile.bagCap,
        equipment: profile.equipment,
      })
    )
  );
}

// 管理员命令系统（开发环境）
const admin = {
  // 重置整个房间（清空所有玩家、子弹、物品）
  resetRoom: () => {
    log('ADMIN_RESET_ROOM', { room: room.id, tick: room.tick });
    // 断开所有连接
    for (const [ws, pid] of connections.entries()) {
      try {
        ws.close();
      } catch (err) {
        console.error('Failed to close connection:', err);
      }
    }
    connections.clear();
    wsToAccountId.clear();
    playerIdToAccountId.clear();
    inputQueues.clear();
    pickupQueues.clear();
    lastProfileSentTick.clear();
    lastExtractedInventoryCount.clear();
    
    // 重新创建房间（会生成新的 seed）
    const newRoom = new Room('local', process.env.SEED ? parseInt(process.env.SEED, 10) : undefined);
    Object.assign(room, newRoom);
    
    console.log('[ADMIN] Room reset complete. New seed:', room.seed);
  },
  
  // 显示当前房间状态
  showRoom: () => {
    console.log('[ADMIN] Room:', {
      id: room.id,
      tick: room.tick,
      seed: room.seed,
      players: room.players.size,
      bullets: Array.from(room.players.values()).reduce((sum, p) => sum, 0), // 简化显示
      connections: connections.size,
    });
  },
  
  // 显示所有玩家
  showPlayers: () => {
    const players = Array.from(room.players.entries()).map(([pid, player]) => ({
      playerId: pid,
      accountId: playerIdToAccountId.get(pid),
      x: player.x.toFixed(1),
      y: player.y.toFixed(1),
      hp: player.hp,
      status: player.status,
      inventory: player.inventory.items.length,
    }));
    console.log('[ADMIN] Players:', players);
  },
  
  // 显示所有 Profile
  showProfiles: () => {
    // 需要访问 room.profileManager 的内部数据
    console.log('[ADMIN] Profile manager attached to room');
    console.log('[ADMIN] Call from room context or check server/data/profiles.json');
  },
  
  // 帮助信息
  help: () => {
    console.log(`
=== 服务端管理员命令 ===
调用方式：在服务端控制台输入 admin.命令名()

可用命令：
  resetRoom()    - 重置整个房间（断开所有连接，重新生成世界）
  showRoom()     - 显示房间状态
  showPlayers()  - 显示所有在线玩家
  showProfiles() - 显示 Profile 信息
  help()         - 显示此帮助信息

例如：
  admin.showRoom()
  admin.resetRoom()
    `);
  }
};

// 将 admin 暴露到全局（仅开发环境）
if (process.env.NODE_ENV !== 'production') {
  (global as any).admin = admin;
  console.log('[SERVER] Admin commands available. Type: admin.help()');
}

wss.on('connection', (ws: WebSocket) => {
  let playerId: string | null = null;

// 节流日志：每200ms打印一次
const messageLogThrottle = new Map<WebSocket, number>();

ws.on('message', (data: Buffer) => {
    try {
      const raw = JSON.parse(data.toString());
      const parsed = C2S_MESSAGE_SCHEMA.parse(raw);

          if (parsed.type === 'C2S_HELLO') {
            // 安全加固：如果已经分配过playerId，忽略重复HELLO（防止幽灵玩家）
            if (playerId !== null) {
              log('DUPLICATE_HELLO', {
                room: room.id,
                player: playerId,
                tick: room.tick,
              });
              return; // 忽略重复HELLO
            }
            
            // 读取客户端发送的 accountId
            const accountId = parsed.accountId;
            
            // 分配玩家ID（本局实体ID，每次连接不同）
            playerId = `p${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            connections.set(ws, playerId);
            wsToAccountId.set(ws, accountId);
            playerIdToAccountId.set(playerId, accountId);
            
            room.addPlayer(playerId, accountId);
            inputQueues.set(playerId, []);
            pickupQueues.set(playerId, []); // P2-3: 初始化 pickup 队列

        log('CONNECT', {
          room: room.id,
          player: playerId,
          accountId: accountId,
          tick: room.tick,
        });

        // Day4-1: 发送WELCOME消息，告知客户端自己的playerId和世界配置
        ws.send(
          JSON.stringify(
            S2C_WELCOME_SCHEMA.parse({
              type: 'S2C_WELCOME',
              playerId: playerId,
              accountId: accountId,
              seed: room.seed,
              mapConfig: room.mapConfig,
            })
          )
        );
        
        // 修复: 发送静态世界初始化消息（一次性下发 obstacles 和初始 items）
        ws.send(
          JSON.stringify(
            S2C_WORLD_INIT_SCHEMA.parse({
              type: 'S2C_WORLD_INIT',
              seed: room.seed,
              mapConfig: room.mapConfig,
              obstacles: room.getObstacles(),
              items: room.getItems(), // 保留兼容
              worldItems: room.getWorldItems(), // 新增: 世界物品列表
            })
          )
        );
        
        // P1-1 新增: 发送 Profile 消息（WELCOME 后立即发送一次）
        sendProfile(ws, accountId);
      } else if (parsed.type === 'C2S_PING') {
        // Day5: 处理 Ping 消息，立即回复 Pong
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify(
              S2C_PONG_SCHEMA.parse({
                type: 'S2C_PONG',
                clientTimestamp: parsed.timestamp,
                serverTimestamp: Date.now(),
              })
            )
          );
        }
      } else if (parsed.type === 'C2S_INTERACT') {
        // 新增: 通用交互消息（服务端选最近可交互目标）
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        // 入队列，不立即处理（使用 type: 'auto' 让 tick 中自动选最近目标）
        const queue = pickupQueues.get(playerId);
        if (queue) {
          queue.push({ type: 'auto', ws });
          log('INTERACT_ENQUEUE', { player: playerId, tick: room.tick });
        }
      } else if (parsed.type === 'C2S_PICKUP_WORLD_ITEM') {
        // 保留兼容（deprecated，建议用 C2S_INTERACT）
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        // 入队列，不立即处理
        const queue = pickupQueues.get(playerId);
        if (queue) {
          queue.push({ type: 'world', wid: parsed.wid, ws });
          log('PICKUP_ENQUEUE', { player: playerId, type: 'world', wid: parsed.wid, tick: room.tick });
        }
      } else if (parsed.type === 'C2S_PICKUP_LOOT_BAG') {
        // 保留兼容（deprecated，建议用 C2S_INTERACT）
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        // 入队列，不立即处理
        const queue = pickupQueues.get(playerId);
        if (queue) {
          queue.push({ type: 'bag', bid: parsed.bid, ws });
          log('PICKUP_ENQUEUE', { player: playerId, type: 'bag', bid: parsed.bid, tick: room.tick });
        }
      } else if (parsed.type === 'C2S_SET_NAME') {
        // 新增: 处理设置昵称
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        // 使用 accountId 获取 Profile
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NO_ACCOUNT',
                message: 'Account ID not found',
              })
            )
          );
          return;
        }
        
        // 更新 Profile 的 displayName
        const updatedProfile = room.profileManager.updateProfile(accountId, {
          displayName: parsed.name,
        });
        
        // 更新玩家对象的 name（如果玩家在房间中）
        const player = room.getPlayer(playerId);
        if (player) {
          player.name = parsed.name;
        }
        
        log('SET_NAME', {
          room: room.id,
          player: playerId,
          accountId: accountId,
          name: parsed.name,
          tick: room.tick,
        });
        
        // 发送更新后的 Profile（phase 变为 HIDEOUT）
        sendProfile(ws, accountId, 'HIDEOUT');
      } else if (parsed.type === 'C2S_SELL_FROM_STASH') {
        // 新增: 处理从仓库卖出物品
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        // 使用 accountId 获取 Profile
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NO_ACCOUNT',
                message: 'Account ID not found',
              })
            )
          );
          return;
        }
        
        const result = room.profileManager.sellFromStash(accountId, parsed.iid, parsed.qty);
        if (!result.success) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'SELL_FAILED',
                message: 'Failed to sell from stash',
              })
            )
          );
        } else {
          // 发送成功消息：立即回发 S2C_PROFILE 刷新客户端 HUD
          log('SELL_FROM_STASH', {
            room: room.id,
            player: playerId,
            accountId: accountId,
            iid: parsed.iid,
            qty: parsed.qty,
            money: result.money,
            tick: room.tick,
          });
          
          // 卖出成功后立即发送 Profile（不然 client HUD 不刷新）
          sendProfile(ws, accountId);
        }
      } else if (parsed.type === 'C2S_MOVE_STASH_TO_PREP') {
        // 新增: 处理从仓库移动到整备区
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NO_ACCOUNT',
                message: 'Account ID not found',
              })
            )
          );
          return;
        }
        
        const result = room.profileManager.moveStashToPrep(accountId, parsed.iid, parsed.qty);
        if (!result.success) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'MOVE_FAILED',
                message: result.message || 'Failed to move from stash to prep',
              })
            )
          );
        } else {
          const updatedProfile = room.profileManager.getProfileData(accountId);
          const phase = updatedProfile.displayName === null ? 'NAME' : 'HIDEOUT';
          sendProfile(ws, accountId, phase);
        }
      } else if (parsed.type === 'C2S_MOVE_PREP_TO_STASH') {
        // 新增: 处理从整备区移动回仓库
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NO_ACCOUNT',
                message: 'Account ID not found',
              })
            )
          );
          return;
        }
        
        const result = room.profileManager.movePrepToStash(accountId, parsed.iid, parsed.qty);
        if (!result.success) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'MOVE_FAILED',
                message: result.message || 'Failed to move from prep to stash',
              })
            )
          );
        } else {
          const updatedProfile = room.profileManager.getProfileData(accountId);
          const phase = updatedProfile.displayName === null ? 'NAME' : 'HIDEOUT';
          // 修复: 使用 sendProfile 函数，确保包含所有必需字段（包括 equipment）
          sendProfile(ws, accountId, phase);
        }
      } else if (parsed.type === 'C2S_BUY') {
        // 新增: 处理商店购买物品
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NO_ACCOUNT',
                message: 'Account ID not found',
              })
            )
          );
          return;
        }
        
        const result = room.profileManager.buyItem(accountId, parsed.typeId, parsed.qty);
        if (!result.success) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'BUY_FAILED',
                message: result.message || 'Failed to buy item',
              })
            )
          );
        } else {
          sendProfile(ws, accountId);
        }
      } else if (parsed.type === 'C2S_EQUIP') {
        // 新增: 处理装备/卸下装备
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NO_ACCOUNT',
                message: 'Account ID not found',
              })
            )
          );
          return;
        }
        
        const result = room.profileManager.equipItem(accountId, parsed.slot, parsed.iid);
        if (!result.success) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'EQUIP_FAILED',
                message: result.message || 'Failed to equip item',
              })
            )
          );
        } else {
          // 如果玩家在战局中，需要更新 weaponRuntime（仅武器槽）
          if (playerId && parsed.slot === 'weapon') {
            room.updatePlayerWeaponFromProfile(playerId, accountId);
          }
          sendProfile(ws, accountId);
        }
      } else if (parsed.type === 'C2S_ENTER_RAID') {
        // 新增: 处理进入战局
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NO_ACCOUNT',
                message: 'Account ID not found',
              })
            )
          );
          return;
        }
        
        const profile = room.profileManager.getProfileData(accountId);
        
        // 修复: 允许空整备进入（MVP 阶段先跑通流程）
        // 不再检查 prep 是否为空，允许玩家空手进入战局
        
        // 修复: 幂等操作 - 如果玩家已经在 raid 中且状态是 ALIVE，直接返回 profile 而不是错误
        const existingPlayer = room.players.get(playerId);
        if (existingPlayer && existingPlayer.status === 'ALIVE') {
          // 玩家已经在 raid 中且活着，直接返回当前 profile（phase=RAID）
          const currentProfile = room.profileManager.getProfileData(accountId);
          sendProfile(ws, accountId, 'RAID');
          log('ENTER_RAID_IDEMPOTENT', {
            room: room.id,
            player: playerId,
            accountId: accountId,
            status: existingPlayer.status,
          });
          return;
        }
        
        // 将 prep 移到 inventory（如果玩家不存在，先创建玩家）
        let player = existingPlayer;
        if (!player) {
          player = room.addPlayer(playerId, accountId);
        } else {
          // 如果玩家已存在（DEAD 或 EXTRACTED 状态），重新 spawn 并复活
          const oldStatus = player.status; // 保存旧状态用于日志
          const spawn = room.findSpawnPoint();
          player.x = spawn.x;
          player.y = spawn.y;
          player.hp = 100;
          player.status = 'ALIVE'; // 修复: 重置状态为 ALIVE（复活）
          player.extractProgress = 0; // 重置撤离进度
          player.clearInventory();
          // 清除击杀信息
          player.killedBy = undefined;
          player.killedByWeaponName = undefined;
          
          // 重新初始化武器运行时状态（在stash和prep中查找）
          if (profile && profile.equipment.weaponIid) {
            const pool = [...profile.stash, ...profile.prep];
            const weaponItem = pool.find(item => item.iid === profile.equipment.weaponIid);
            if (weaponItem) {
              try {
                const weaponDef = getWeaponDef(weaponItem.typeId);
                player.weaponRuntime = {
                  weaponTypeId: weaponItem.typeId,
                  ammoInMag: weaponDef.magSize,
                  reloadingUntilTick: 0,
                  nextFireTick: room.tick,
                };
              } catch {
                // 无效武器类型，使用默认 FISTS
                const defaultWeaponDef = getWeaponDef('w_fists');
                player.weaponRuntime = {
                  weaponTypeId: 'w_fists',
                  ammoInMag: 0,
                  reloadingUntilTick: 0,
                  nextFireTick: room.tick,
                };
              }
            } else {
              // 武器不在 stash 或 prep 中，使用默认 FISTS
              const defaultWeaponDef = getWeaponDef('w_fists');
              player.weaponRuntime = {
                weaponTypeId: 'w_fists',
                ammoInMag: 0,
                reloadingUntilTick: 0,
                nextFireTick: room.tick,
              };
            }
          } else {
            // 没有装备武器，使用默认 FISTS
            const defaultWeaponDef = getWeaponDef('w_fists');
            player.weaponRuntime = {
              weaponTypeId: 'w_fists',
              ammoInMag: 0,
              reloadingUntilTick: 0,
              nextFireTick: room.tick,
            };
          }
          
          log('PLAYER_RESPAWN', {
            room: room.id,
            player: playerId,
            accountId: accountId,
            oldStatus: oldStatus,
            newStatus: 'ALIVE',
            tick: room.tick,
          });
        }
        
        // 将 prep 物品移到 inventory（允许空 prep）
        const prepItems = profile.prep || [];
        for (const prepItem of prepItems) {
          // 检查背包容量
          const currentCount = player.inventory.items.reduce((sum, item) => sum + item.qty, 0);
          if (currentCount + prepItem.qty > player.inventory.bagCap) {
            // 容量不足，只添加能装下的部分
            const canAdd = player.inventory.bagCap - currentCount;
            if (canAdd > 0) {
              player.inventory.items.push({
                iid: prepItem.iid,
                typeId: prepItem.typeId,
                qty: canAdd,
              });
            }
            break;
          } else {
            // 尝试堆叠
            const existing = player.inventory.items.find(item => item.typeId === prepItem.typeId);
            if (existing) {
              existing.qty += prepItem.qty;
            } else {
              player.inventory.items.push({
                iid: prepItem.iid,
                typeId: prepItem.typeId,
                qty: prepItem.qty,
              });
            }
          }
        }
        
        // 清空 prep
        room.profileManager.updateProfile(accountId, { prep: [] });
        
        // 发送更新的 Profile（phase=RAID）
        // 修复: 使用 sendProfile 函数，确保包含所有必需字段（包括 equipment）
        sendProfile(ws, accountId, 'RAID');
        
        log('ENTER_RAID', {
          room: room.id,
          player: playerId,
          accountId: accountId,
          prepCount: profile.prep.length,
          inventoryCount: player.inventory.items.length,
        });
      } else if (parsed.type === 'C2S_ADMIN') {
        // 管理员命令（仅开发环境）
        if (process.env.NODE_ENV === 'production') {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'FORBIDDEN',
                message: 'Admin commands disabled in production',
              })
            )
          );
          return;
        }
        
        log('ADMIN_COMMAND', {
          room: room.id,
          player: playerId ?? 'unknown',
          command: parsed.command,
          tick: room.tick,
        });
        
        if (parsed.command === 'show_status') {
          // 发送房间状态给客户端
          ws.send(
            JSON.stringify(
              S2C_EVENT_SCHEMA.parse({
                type: 'S2C_EVENT',
                tick: room.tick,
                timestamp: Date.now(),
                message: `Room: tick=${room.tick}, players=${room.players.size}, seed=${room.seed}`,
              })
            )
          );
        } else if (parsed.command === 'reset_world') {
          // 通知所有客户端即将重置
          for (const [clientWs] of connections.entries()) {
            try {
              clientWs.send(
                JSON.stringify(
                  S2C_EVENT_SCHEMA.parse({
                    type: 'S2C_EVENT',
                    tick: room.tick,
                    timestamp: Date.now(),
                    message: 'Server is resetting world...',
                  })
                )
              );
            } catch (err) {
              // 忽略发送失败
            }
          }
          
          // 延迟100ms后重置（给客户端时间显示消息）
          setTimeout(() => {
            admin.resetRoom();
          }, 100);
        }
      } else if (parsed.type === 'C2S_INPUT') {
        if (!playerId) {
          ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'NOT_AUTHENTICATED',
                message: 'Must send C2S_HELLO first',
              })
            )
          );
          return;
        }

        // 节流日志：每200ms打印一次
        const lastLog = messageLogThrottle.get(ws) || 0;
        const now = Date.now();
        if (now - lastLog >= 200) {
          log('RECV_INPUT', {
            room: room.id,
            player: playerId,
            tick: room.tick,
            seq: parsed.seq,
            inputTick: parsed.tick,
            keys: `${parsed.keys.up ? 'U' : ''}${parsed.keys.down ? 'D' : ''}${parsed.keys.left ? 'L' : ''}${parsed.keys.right ? 'R' : ''}`,
          });
          messageLogThrottle.set(ws, now);
        }

        // 将输入加入队列（tick循环会处理）
        const queue = inputQueues.get(playerId);
        if (queue) {
          queue.push({ input: parsed, ws });
          
          // 队列保护：超过最大长度时丢弃旧的
          if (queue.length > INPUT_QUEUE_MAX_LENGTH) {
            const dropped = queue.length - INPUT_QUEUE_MAX_LENGTH;
            queue.splice(0, dropped);
            
            // 节流警告日志（每5秒最多一次）
            const now = Date.now();
            if (now - lastQueueWarnTime >= 5000) {
              log('QUEUE_OVERFLOW', {
                room: room.id,
                player: playerId,
                tick: room.tick,
                dropped,
                maxLength: INPUT_QUEUE_MAX_LENGTH,
              });
              lastQueueWarnTime = now;
            }
          }
        }
      }
    } catch (error) {
      log('ERROR', {
        room: room.id,
        tick: room.tick,
        error: error instanceof Error ? error.message : String(error),
      });

      ws.send(
        JSON.stringify(
          S2C_ERROR_SCHEMA.parse({
            type: 'S2C_ERROR',
            code: 'PARSE_ERROR',
            message: error instanceof Error ? error.message : String(error),
          })
        )
      );
    }
  });

  ws.on('close', () => {
    if (playerId) {
      room.removePlayer(playerId);
      connections.delete(ws);
      wsToAccountId.delete(ws);
      playerIdToAccountId.delete(playerId);
      inputQueues.delete(playerId);
      pickupQueues.delete(playerId); // P2-3: 清理 pickup 队列
    }
  });

  ws.on('error', (error) => {
    log('WS_ERROR', {
      room: room.id,
      tick: room.tick,
      error: error.message,
    });
  });
});

// Tick 循环（20Hz）
setInterval(() => {
  room.tick++;

  // Day2: 先处理输入（可能生成子弹）
  // 修复: 按序处理最多 N 条，避免队列为空时不移动（解决 err=10 问题）
  const MAX_STEPS = 4; // 每 tick 最多追 4 步，避免被恶意灌爆
  for (const [playerId, queue] of inputQueues.entries()) {
    if (queue.length === 0) {
      // 修复: 记录队列为空的情况，便于诊断
      if (room.tick % 100 === 0) { // 每 5 秒记录一次，避免日志过多
        log('NO_INPUT_THIS_TICK', { player: playerId, tick: room.tick });
      }
      continue;
    }
    
    // 修复: 按 seq 升序排序，按序处理（而不是只处理最新一条）
    queue.sort((a, b) => a.input.seq - b.input.seq);
    
    // 只处理最后 MAX_STEPS 条，避免被恶意灌爆
    const slice = queue.length > MAX_STEPS ? queue.slice(queue.length - MAX_STEPS) : queue;
    
    // 聚合一次性事件（interact/extract）只在最后一条处理
    let aggregatedInteract = false;
    let aggregatedExtract = false;
    for (const e of slice) {
      if (e.input.interact) aggregatedInteract = true;
      if (e.input.extract) aggregatedExtract = true;
    }
    
    // 按序处理每条 input（保证移动连续性）
    for (let i = 0; i < slice.length; i++) {
      const raw = slice[i].input;
      const isLast = i === slice.length - 1;
      room.processInput(playerId, {
        ...raw,
        // 只在最后一条处理一次性事件，避免重复触发
        interact: isLast ? aggregatedInteract : false,
        extract: isLast ? aggregatedExtract : false,
      });
    }
    
    // 清空队列
    queue.length = 0;
  }
  
  // P2-3: 处理 pickup 队列（在移动处理之后，确保位置对齐）
  for (const [playerId, queue] of pickupQueues.entries()) {
    if (queue.length === 0) continue;
    
    // 只处理最后一个请求（避免重复拾取）
    const lastReq = queue[queue.length - 1];
    
    if (lastReq.type === 'auto') {
      // 新增: 服务端自动选最近可交互目标
      const result = room.handleAutoInteract(playerId);
      if (!result.success) {
        if (lastReq.ws.readyState === WebSocket.OPEN && result.message) {
          lastReq.ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'INTERACT_FAILED',
                message: result.message,
              })
            )
          );
        }
      } else {
        log('INTERACT_OK', { player: playerId, target: result.target, tick: room.tick });
      }
    } else if (lastReq.type === 'world') {
      const result = room.handlePickupWorldItem(playerId, lastReq.wid);
      if (!result.success) {
        const player = room.getPlayer(playerId);
        log('PICKUP_FAIL', {
          player: playerId,
          type: 'world',
          wid: lastReq.wid,
          reason: result.message,
          playerPos: player ? `(${player.x.toFixed(1)},${player.y.toFixed(1)})` : 'N/A',
          tick: room.tick,
        });
        if (lastReq.ws.readyState === WebSocket.OPEN) {
          lastReq.ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'PICKUP_FAILED',
                message: result.message || 'Failed to pickup world item',
              })
            )
          );
        }
      } else {
        log('PICKUP_OK', { player: playerId, type: 'world', wid: lastReq.wid, tick: room.tick });
      }
    } else if (lastReq.type === 'bag') {
      const result = room.handlePickupLootBag(playerId, lastReq.bid);
      if (!result.success) {
        const player = room.getPlayer(playerId);
        log('PICKUP_FAIL', {
          player: playerId,
          type: 'bag',
          bid: lastReq.bid,
          reason: result.message,
          playerPos: player ? `(${player.x.toFixed(1)},${player.y.toFixed(1)})` : 'N/A',
          tick: room.tick,
        });
        if (lastReq.ws.readyState === WebSocket.OPEN) {
          lastReq.ws.send(
            JSON.stringify(
              S2C_ERROR_SCHEMA.parse({
                type: 'S2C_ERROR',
                code: 'PICKUP_FAILED',
                message: result.message || 'Failed to pickup loot bag',
              })
            )
          );
        }
      } else {
        log('PICKUP_OK', { player: playerId, type: 'bag', bid: lastReq.bid, tick: room.tick });
      }
    }
    
    // 清空队列
    queue.length = 0;
  }
  
  // P1-1 修复: 检查所有玩家是否刚完成撤离，发送更新的 Profile
  // 只在"玩家状态变为 EXTRACTED 且背包已清空"的那一刻发送一次
  for (const [playerId, player] of room.players.entries()) {
    if (player.status === 'EXTRACTED') {
      const lastSent = lastProfileSentTick.get(playerId) ?? -1;
      const lastInvCount = lastExtractedInventoryCount.get(playerId) ?? -1;
      
      // 判断是否刚完成撤离：
      // 1. 背包已清空（items.length === 0）
      // 2. 上次记录的背包数量 !== 0（说明刚刚被清空）
      // 3. 还没在这个 tick 发送过 Profile
      const justExtracted = player.inventory.items.length === 0 && lastInvCount !== 0;
      
      if (justExtracted && lastSent < room.tick) {
        const ws = Array.from(connections.entries()).find(([, pid]) => pid === playerId)?.[0];
        if (ws && ws.readyState === WebSocket.OPEN) {
          // 使用 accountId 获取 Profile
          const accountId = playerIdToAccountId.get(playerId);
          if (accountId) {
            const profile = room.profileManager.getProfileData(accountId);
            const phase = profile.displayName === null ? 'NAME' : 'HIDEOUT';
            sendProfile(ws, accountId, phase);
            lastProfileSentTick.set(playerId, room.tick);
          }
        }
      }
      
      // 更新记录的背包数量
      lastExtractedInventoryCount.set(playerId, player.inventory.items.length);
    }
  }
  
  // 新增: 处理战局结果（撤离/死亡）
  for (const [playerId, result] of room.raidResults.entries()) {
    const ws = Array.from(connections.entries()).find(([, pid]) => pid === playerId)?.[0];
    if (ws && ws.readyState === WebSocket.OPEN) {
      // 发送 S2C_RAID_RESULT
      ws.send(
        JSON.stringify(
          S2C_RAID_RESULT_SCHEMA.parse({
            type: 'S2C_RAID_RESULT',
            result: result.result,
            loot: result.loot ?? [],
            moneyGained: result.moneyGained ?? 0,
            moneyLost: result.moneyLost ?? 0,
          })
        )
      );
      
      // 发送更新的 Profile（phase=RESULT）
      // 修复: 使用 sendProfile 函数，确保包含所有必需字段（包括 equipment）
      sendProfile(ws, result.accountId, 'RESULT');
      
      log('RAID_RESULT_SENT', {
        room: room.id,
        player: playerId,
        accountId: result.accountId,
        result: result.result,
        tick: room.tick,
      });
    }
    
    // 从队列中移除（只发送一次）
    room.raidResults.delete(playerId);
  }

  // 新增: 更新所有玩家的撤离进度（每 tick 自动检查，不依赖输入）
  room.updateExtractProgress();
  
  // 新增: 更新所有玩家的武器状态（处理换弹完成）
  for (const playerId of room.players.keys()) {
    room.updateWeaponRuntime(playerId);
  }
  
  // Day2: 更新子弹位置并检测命中（20Hz tick = 50ms = 0.05s）
  const deltaTime = 0.05;
  room.updateBullets(deltaTime);
  
  // 新增: 处理战斗事件（干火/命中/受伤反馈）
  const combatEvents = room.drainCombatEvents();
  for (const [playerId, events] of combatEvents.entries()) {
    const ws = Array.from(connections.entries()).find(([, pid]) => pid === playerId)?.[0];
    if (ws && ws.readyState === WebSocket.OPEN) {
      // 发送所有战斗事件（可能有多条，例如同时命中多个目标）
      for (const event of events) {
        ws.send(
          JSON.stringify(
            S2C_COMBAT_EVENT_SCHEMA.parse({
              type: 'S2C_COMBAT_EVENT',
              kind: event.kind,
              direction: event.direction,
            })
          )
        );
      }
    }
  }

  // 每10个tick打印一次汇总（约0.5秒）
  if (room.tick % 10 === 0) {
    log('TICK', {
      room: room.id,
      tick: room.tick,
      players: room.players.size,
      bullets: room.bullets.length,
      items: room.items.length,
    });
  }
}, TICK_INTERVAL_MS);

// Snapshot 广播循环（10Hz）
setInterval(() => {
  const snapshot = room.getSnapshot();
  const message = S2C_SNAPSHOT_SCHEMA.parse({
    type: 'S2C_SNAPSHOT',
    tick: room.tick,
    timestamp: Date.now(),
    players: snapshot.players,
    bullets: snapshot.bullets,
    items: snapshot.items, // 保留兼容
    worldItems: snapshot.worldItems, // 新增: 世界物品列表（MVP 全量，未来做 delta）
    lootBags: snapshot.lootBags, // 新增: 掉落包列表
    // 修复: obstacles 已移至 S2C_WORLD_INIT，不再在 snapshot 中发送（减少带宽）
  });

  // 广播给所有连接
  for (const ws of connections.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}, SNAPSHOT_INTERVAL_MS);

// 游戏化增强: 事件广播循环（10Hz，与 snapshot 同步）
setInterval(() => {
  const events = room.drainEvents();
  if (events.length === 0) {
    return; // 没有新事件，跳过
  }

  // 广播每条事件给所有连接
  for (const event of events) {
    const message = S2C_EVENT_SCHEMA.parse({
      type: 'S2C_EVENT',
      tick: event.tick,
      timestamp: event.timestamp,
      message: event.message,
    });

    for (const ws of connections.keys()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch (err) {
          // 发送失败不影响主循环（静默忽略）
        }
      }
    }
  }
}, SNAPSHOT_INTERVAL_MS);

log('Server listening', {
  room: room.id,
  tick: 0,
  host: HOST,
  port: PORT.toString(),
});

