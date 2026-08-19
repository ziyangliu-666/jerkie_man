import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import sirv from 'sirv';
import { Room } from './room.js';
import { getMapTemplate, listMapTemplateIds, loadMapTemplates, resolveMapTemplateDir } from './mapTemplates.js';
import { log } from './logger.js';
import crypto from 'crypto';
import { deflateSync } from 'zlib';
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
  S2C_MELEE_SWING_SCHEMA, // 新增: 近战挥击事件
  S2C_EXPLOSION_SCHEMA, // 新增: 爆炸事件
  S2C_SMOKE_SCHEMA, // 新增: 烟雾事件
  S2C_FIRE_SCHEMA, // 新增: 燃烧事件
  S2C_KILL_FEED_SCHEMA, // 新增: 击杀播报
  S2C_MAP_LIST_SCHEMA, // 地图列表回执
  S2C_PLAYER_LIST_SCHEMA, // 在线玩家列表回执
  S2C_AUTO_EQUIP_SCHEMA, // 局内自动装备回执
  type ERROR_CODE,
  getWeaponDef, // 新增: 用于重置武器运行时状态
  TICK_MS,
  SNAPSHOT_MS,
  encodeMessage, // 二进制编码
  exportFieldMapping, // 动态字段压缩
  type C2S_MESSAGE,
} from '@ziyang-protocol/shared';

// 支持从环境变量读取端口和主机地址（CI友好）
const PORT = Number(process.env.PORT) || 18723;
const HOST = process.env.HOST || '0.0.0.0'; // 默认监听所有网络接口
const TICK_INTERVAL_MS = TICK_MS; // 20Hz
const SNAPSHOT_INTERVAL_MS = SNAPSHOT_MS; // 10Hz

// 管理员口令仅从环境变量读取，仓库中不保留任何默认值。
// 未设置 ADMIN_PASSWORD 时管理员登录整体关闭，避免出现「人人皆知的默认密码」。
// Fly.io 设置方式：fly secrets set ADMIN_PASSWORD=...
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const ADMIN_PASSWORD_HASH = ADMIN_PASSWORD
  ? crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex')
  : null;

if (!ADMIN_PASSWORD_HASH) {
  console.warn('[SECURITY] ADMIN_PASSWORD is not set; admin login is disabled.');
}

// 静态资源目录（client 构建产物），与 WebSocket 共用同一端口，实现同源部署
const __main_filename = fileURLToPath(import.meta.url);
const __main_dirname = path.dirname(__main_filename);
const CLIENT_DIR = process.env.CLIENT_DIR
  ? path.resolve(process.env.CLIENT_DIR)
  : path.join(__main_dirname, '..', '..', 'client', 'dist');

// sirv 负责 MIME、ETag、Range（音频播放需要）、以及带 hash 的静态资源长缓存
const serveStatic = sirv(CLIENT_DIR, {
  single: true,      // SPA fallback 到 index.html
  etag: true,
  gzip: true,
  brotli: true,
  setHeaders(res, pathname) {
    // Vite 产物带内容 hash，可长期缓存；其余走协商缓存
    if (pathname.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (pathname.startsWith('/audio/')) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
});

const httpServer = http.createServer((req, res) => {
  // 平台健康检查端点
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  serveStatic(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
});

// 启用 WebSocket 压缩（permessage-deflate）
const wss = new WebSocketServer({ 
  server: httpServer,
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3, // 压缩级别 1-9，3 是速度与压缩率的平衡点
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024,
    },
    clientNoContextTakeover: true, // 客户端不保留上下文（节省内存）
    serverNoContextTakeover: true, // 服务端不保留上下文
    serverMaxWindowBits: 10,       // 服务端窗口大小
    concurrencyLimit: 10,          // 并发压缩限制
    threshold: 1024,               // 只压缩大于 1KB 的消息
  },
});

const mapTemplateDir = resolveMapTemplateDir(process.env.MAP_TEMPLATE_DIR);
let mapTemplateCatalog = loadMapTemplates(mapTemplateDir);
let activeMapTemplateId = process.env.MAP_TEMPLATE?.trim() ?? null;
let activeMapTemplate = getMapTemplate(mapTemplateCatalog, activeMapTemplateId);

if (activeMapTemplateId && !activeMapTemplate) {
  console.warn(`[SERVER] Map template "${activeMapTemplateId}" not found in ${mapTemplateDir}`);
  console.warn(`[SERVER] Available templates: ${listMapTemplateIds(mapTemplateCatalog).join(', ')}`);
}

function parseEnvSeed(): number | undefined {
  if (process.env.SEED === undefined) return undefined;
  const envSeed = parseInt(process.env.SEED, 10);
  if (isNaN(envSeed)) {
    throw new Error(`Invalid SEED environment variable: ${process.env.SEED}`);
  }
  return envSeed;
}

function createRoom(): Room {
  return new Room('local', {
    seed: parseEnvSeed(),
    mapTemplate: activeMapTemplate,
  });
}

let room = createRoom();

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

// 新增: 使用物品队列（快捷栏1-5键）
type UseItemReq = { slot: number; ws: WebSocket };
const useItemQueues = new Map<string, UseItemReq[]>();

// 新增: 投掷物品队列
type ThrowReq = { targetX: number; targetY: number; itemType: string; ws: WebSocket };
const throwQueues = new Map<string, ThrowReq[]>();

// P1-1 修复: lastProfileSentTick 移至模块级，避免每 tick 重新创建导致重复发送
const lastProfileSentTick = new Map<string, number>();

// ✅ 维护 accountId → playerId 的映射
const accountIdToPlayerId = new Map<string, string>();

// 延迟补偿: 玩家延迟追踪（记录每个玩家的 RTT）
type PlayerLatency = {
  rtt: number;           // 往返延迟（Round-Trip Time，毫秒）
  lastPongAt: number;    // 上次收到 Pong 的时间戳
  pongCount: number;     // 收到的 Pong 数量（用于平滑）
};
const playerLatencies = new Map<string, PlayerLatency>(); // playerId -> PlayerLatency
// 新增: 记录玩家撤离时的背包物品数（用于判断"刚完成撤离"）
const lastExtractedInventoryCount = new Map<string, number>();

// ---------------------------------------------------------------------------
// Wire helpers
//
// Nothing on the wire is prose. Errors carry a code, events carry a catalog key
// plus params; the client owns every word the player reads.
// ---------------------------------------------------------------------------
type EventParams = Record<string, string | number>;

function sendError(ws: WebSocket, code: ERROR_CODE, params?: EventParams): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(S2C_ERROR_SCHEMA.parse({ type: 'S2C_ERROR', code, params })));
}

function sendEvent(ws: WebSocket, key: string, params?: EventParams): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify(
      S2C_EVENT_SCHEMA.parse({
        type: 'S2C_EVENT',
        tick: room.tick,
        timestamp: Date.now(),
        key,
        params,
      })
    )
  );
}

function sendMapList(ws: WebSocket, maps: string[]): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(S2C_MAP_LIST_SCHEMA.parse({ type: 'S2C_MAP_LIST', maps })));
}

function sendPlayerList(ws: WebSocket): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const players = Array.from(room.players.values()).map((player) => ({
    name: player.name ?? '',
    hp: Math.max(0, Math.round(player.hp)),
    alive: player.status === 'ALIVE',
  }));
  ws.send(JSON.stringify(S2C_PLAYER_LIST_SCHEMA.parse({ type: 'S2C_PLAYER_LIST', players })));
}

// 辅助函数：发送Profile消息
function sendProfile(ws: WebSocket, accountId: string, phase?: 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT'): void {
  const profile = room.profileManager.getProfileData(accountId);
  // ✅ 关键：优先使用持久化的 profile.phase，如果提供了 phase 参数则覆盖
  const profilePhase = phase ?? profile.phase;
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
        isAdmin: profile.isAdmin === true,
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
    useItemQueues.clear(); // 新增: 清理使用物品队列
    lastProfileSentTick.clear();
    lastExtractedInventoryCount.clear();

    // 重新创建房间（产生新的世界 identity）
    room = createRoom();
    
    console.log('[ADMIN] Room reset complete. New seed:', room.seed);
  },
  
  // 显示当前房间状态
  showRoom: () => {
    console.log('[ADMIN] Room:', {
      id: room.id,
      tick: room.tick,
      seed: room.seed,
      mapTemplateId: room.mapTemplateId ?? null,
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

  listMapTemplates: () => {
    console.log('[ADMIN] Map templates:', listMapTemplateIds(mapTemplateCatalog));
    console.log('[ADMIN] Map template dir:', mapTemplateCatalog.dir);
  },

  reloadMapTemplates: () => {
    mapTemplateCatalog = loadMapTemplates(mapTemplateDir);
    activeMapTemplate = getMapTemplate(mapTemplateCatalog, activeMapTemplateId);
    if (activeMapTemplateId && !activeMapTemplate) {
      console.warn(`[ADMIN] Map template "${activeMapTemplateId}" not found in ${mapTemplateDir}`);
    }
    console.log('[ADMIN] Map templates reloaded.');
  },

  setMapTemplate: (id: string | null) => {
    if (!id) {
      activeMapTemplateId = null;
      activeMapTemplate = undefined;
      console.log('[ADMIN] Map template cleared. Using random map generation.');
      admin.resetRoom();
      return;
    }
    const next = getMapTemplate(mapTemplateCatalog, id);
    if (!next) {
      console.warn(`[ADMIN] Map template "${id}" not found in ${mapTemplateDir}`);
      return;
    }
    activeMapTemplateId = id;
    activeMapTemplate = next;
    console.log(`[ADMIN] Map template set to "${id}". Resetting room...`);
    admin.resetRoom();
  },
  
  // 帮助信息
  help: () => {
    console.log(`
=== Server admin console ===
Call these from the server console, e.g. admin.showRoom()

  resetRoom()          - drop every connection and regenerate the world
  showRoom()           - print room state
  showPlayers()        - print every connected player
  showProfiles()       - print profile storage info
  listMapTemplates()   - list available map templates
  reloadMapTemplates() - reload map templates from disk
  setMapTemplate(id)   - switch map template and reset the room (null clears it)
  help()               - print this help
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

            // 简化逻辑：总是清理旧玩家实体，创建新玩家
            // 检查是否有该accountId的旧玩家
            const existingPlayerId = accountIdToPlayerId.get(accountId);
            if (existingPlayerId) {
              log('CLEANUP_OLD_PLAYER', {
                room: room.id,
                player: existingPlayerId,
                accountId: accountId,
                tick: room.tick,
              });

              // 清理旧玩家实体和所有相关数据
              room.removePlayer(existingPlayerId);
              inputQueues.delete(existingPlayerId);
              pickupQueues.delete(existingPlayerId);
              useItemQueues.delete(existingPlayerId);
              throwQueues.delete(existingPlayerId);
              playerLatencies.delete(existingPlayerId);
              accountIdToPlayerId.delete(accountId);

              // 断开旧的WebSocket连接（如果还存在）
              for (const [oldWs, oldPid] of connections.entries()) {
                if (oldPid === existingPlayerId) {
                  oldWs.close();
                  connections.delete(oldWs);
                  wsToAccountId.delete(oldWs);
                  playerIdToAccountId.delete(oldPid);
                  break;
                }
              }
            }

            // 总是创建新的玩家实体
            playerId = `p${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            connections.set(ws, playerId);
            wsToAccountId.set(ws, accountId);
            playerIdToAccountId.set(playerId, accountId);
            accountIdToPlayerId.set(accountId, playerId);

            room.addPlayer(playerId, accountId);
            inputQueues.set(playerId, []);
            pickupQueues.set(playerId, []);
            useItemQueues.set(playerId, []);
            throwQueues.set(playerId, []);

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
              fieldMapping: exportFieldMapping(), // 动态字段压缩映射表
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
              lootBags: room.getLootBags(), // 新增: 掉落包列表
              rooms: room.getRooms(), // 新增: 房间列表（用于地板渲染）
            })
          )
        );
        
        // P1-1 新增: 发送 Profile 消息（WELCOME 后立即发送一次）
        // ✅ 修复：如果玩家 phase 是 RESULT 或 RAID（刷新后重连），自动重置为 HIDEOUT
        // 原因：刷新后玩家实体已被清理，无法继续战局，应该返回藏身处
        const profile = room.profileManager.getProfileData(accountId);
        if (profile.phase === 'RESULT' || profile.phase === 'RAID') {
          log('PHASE_RESET_ON_RECONNECT', { accountId, from: profile.phase, to: 'HIDEOUT' });
          room.profileManager.updatePhase(accountId, 'HIDEOUT');
        }
        sendProfile(ws, accountId);
       } else if (parsed.type === 'C2S_CHAT') {
          // Chat/Command handling
          if (!playerId) return;
          
          // Get accountId from player
          const accountId = playerIdToAccountId.get(playerId);
          if (!accountId) return;
          
          const content = parsed.content.trim();
          if (content.startsWith('/')) {
            // Command handling
            const [cmd, ...args] = content.substring(1).split(' ');

            // Get profile to check admin status
            const profile = room.profileManager.getProfileData(accountId);
            const isAdmin = profile.isAdmin === true;

            if (cmd === 'admin') {
              // Admin authentication command
              const password = args.join(' ');
              const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

              if (ADMIN_PASSWORD_HASH !== null && passwordHash === ADMIN_PASSWORD_HASH) {
                profile.isAdmin = true;
                room.profileManager.updateProfile(accountId, { isAdmin: true });
                sendEvent(ws, 'cmd.admin.granted');
                sendProfile(ws, accountId); // ✅ Sync updated profile (including isAdmin) to client
                log('ADMIN_AUTH_SUCCESS', { accountId });
              } else {
                sendEvent(ws, 'cmd.admin.denied');
                log('ADMIN_AUTH_FAILED', { accountId });
              }
            } else if (cmd === 'map') {
              // Check admin permission
              if (!isAdmin) {
                sendEvent(ws, 'cmd.adminOnly');
                return;
              }

              const mapId = args.join(' ');
              if (!mapId) {
                sendEvent(ws, 'cmd.map.usage');
              } else {
                const next = getMapTemplate(mapTemplateCatalog, mapId);
                if (!next) {
                  sendEvent(ws, 'cmd.map.notFound', { map: mapId });
                } else {
                  activeMapTemplateId = mapId;
                  activeMapTemplate = next;
                  admin.resetRoom();
                  // 所有连接已断开，这里的 ws 可能已失效，甚至不需要回执
                }
              }
            } else if (cmd === 'maps') {
              // Machine-readable list + a line the player actually sees
              const ids = listMapTemplateIds(mapTemplateCatalog);
              sendMapList(ws, ids);
              sendEvent(ws, 'cmd.maps.list', { maps: ids.join(', ') });
            } else if (cmd === 'maplist') {
              // Silent version for autocomplete sync
              sendMapList(ws, listMapTemplateIds(mapTemplateCatalog));
            } else if (cmd === 'reset') {
              // Check admin permission
              if (!isAdmin) {
                sendEvent(ws, 'cmd.adminOnly');
                return;
              }
              admin.resetRoom();
            } else if (cmd === 'players') {
              // Roster goes over the structured message; the event just tells the
              // client to print it.
              sendPlayerList(ws);
              sendEvent(ws, 'cmd.players.roster', { count: room.players.size });
            } else if (cmd === 'playerlist') {
              // Silent version for autocomplete sync
              sendPlayerList(ws);
            } else if (cmd === 'give') {
              // Give money to player
              if (!isAdmin) {
                sendEvent(ws, 'cmd.adminOnly');
                return;
              }

              const targetName = args[0];
              const amount = parseInt(args[1], 10);

              if (!targetName || isNaN(amount)) {
                sendEvent(ws, 'cmd.give.usage');
                return;
              }

              // Find player by name
              let targetAccountId: string | null = null;

              room.players.forEach((player, pid) => {
                if (player.name === targetName) {
                  const accId = playerIdToAccountId.get(pid);
                  if (accId) {
                    targetAccountId = accId;
                  }
                }
              });

              if (!targetAccountId) {
                sendEvent(ws, 'cmd.playerNotFound', { name: targetName });
                return;
              }

              // Add money
              const targetProfile = room.profileManager.getProfileData(targetAccountId);
              targetProfile.money += amount;
              room.profileManager.updateProfile(targetAccountId, { money: targetProfile.money });

              sendEvent(ws, 'cmd.give.ok', { name: targetName, amount });
              log('ADMIN_GIVE_MONEY', { admin: accountId, target: targetName, amount });
            } else if (cmd === 'heal') {
              // Heal player
              if (!isAdmin) {
                sendEvent(ws, 'cmd.adminOnly');
                return;
              }

              const targetName = args[0];
              if (!targetName) {
                sendEvent(ws, 'cmd.heal.usage');
                return;
              }

              let healed = false;
              room.players.forEach((player) => {
                if (player.name === targetName) {
                  player.hp = 100; // Max HP is always 100
                  healed = true;
                }
              });

              if (healed) {
                sendEvent(ws, 'cmd.heal.ok', { name: targetName });
                log('ADMIN_HEAL', { admin: accountId, target: targetName });
              } else {
                sendEvent(ws, 'cmd.playerNotFound', { name: targetName });
              }
            } else if (cmd === 'kill') {
              // Kill player
              if (!isAdmin) {
                sendEvent(ws, 'cmd.adminOnly');
                return;
              }

              const targetName = args[0];
              if (!targetName) {
                sendEvent(ws, 'cmd.kill.usage');
                return;
              }

              let killed = false;
              room.players.forEach((player, pid) => {
                if (player.name === targetName && player.status === 'ALIVE') {
                  player.hp = 0;
                  player.killedBy = { kind: 'admin' };
                  player.killedByWeapon = { kind: 'special', specialId: 'console' };
                  room.handlePlayerDeath(pid);
                  killed = true;
                }
              });

              if (killed) {
                sendEvent(ws, 'cmd.kill.ok', { name: targetName });
                log('ADMIN_KILL', { admin: accountId, target: targetName });
              } else {
                sendEvent(ws, 'cmd.alivePlayerNotFound', { name: targetName });
              }
            } else if (cmd === 'kick') {
              // Kick player
              if (!isAdmin) {
                sendEvent(ws, 'cmd.adminOnly');
                return;
              }

              const targetName = args[0];
              if (!targetName) {
                sendEvent(ws, 'cmd.kick.usage');
                return;
              }

              let kicked = false;
              for (const [targetWs, targetPid] of connections.entries()) {
                const player = room.players.get(targetPid);
                if (player && player.name === targetName) {
                  targetWs.close();
                  kicked = true;
                  break;
                }
              }

              if (kicked) {
                sendEvent(ws, 'cmd.kick.ok', { name: targetName });
                log('ADMIN_KICK', { admin: accountId, target: targetName });
              } else {
                sendEvent(ws, 'cmd.playerNotFound', { name: targetName });
              }
            } else if (cmd === 'help') {
              sendEvent(ws, isAdmin ? 'cmd.help.admin' : 'cmd.help.player');
            } else if (cmd === 'ping') {
              sendEvent(ws, 'cmd.ping.pong');
            } else {
              sendEvent(ws, 'cmd.unknown', { command: cmd });
            }
          } else {
            // 普通聊天（暂时只回显给自己）
            sendEvent(ws, 'chat.self', { text: content });
          }

      } else if (parsed.type === 'C2S_PING') {
        // Day5: 处理 Ping 消息，立即回复 Pong
        const serverTimestamp = Date.now();
        const rtt = serverTimestamp - parsed.timestamp;

        // 延迟补偿: 更新延迟记录（使用指数移动平均平滑）
        if (playerId) {
          const existing = playerLatencies.get(playerId);
          if (existing) {
            // 指数移动平均：90% 旧值 + 10% 新值
            existing.rtt = existing.rtt * 0.9 + rtt * 0.1;
            existing.lastPongAt = serverTimestamp;
            existing.pongCount++;
          } else {
            playerLatencies.set(playerId, { rtt, lastPongAt: serverTimestamp, pongCount: 1 });
          }
        }

        // 发送 Pong
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify(
              S2C_PONG_SCHEMA.parse({
                type: 'S2C_PONG',
                clientTimestamp: parsed.timestamp,
                serverTimestamp: serverTimestamp,
              })
            )
          );
        }
      } else if (parsed.type === 'C2S_INTERACT') {
        // 新增: 通用交互消息（服务端选最近可交互目标）
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        // 入队列，不立即处理（使用 type: 'auto' 让 tick 中自动选最近目标）
        const queue = pickupQueues.get(playerId);
        if (queue) {
          queue.push({ type: 'auto', ws });
          log('INTERACT_ENQUEUE', { player: playerId, tick: room.tick });
        }
      } else if (parsed.type === 'C2S_USE_ITEM') {
        // 新增: 使用物品消息（快捷栏1-5键）
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        // 入队列，不立即处理
        const queue = useItemQueues.get(playerId);
        if (queue) {
          queue.push({ slot: parsed.slot, ws });
          log('USE_ITEM_ENQUEUE', { player: playerId, slot: parsed.slot, tick: room.tick });
        }
      } else if (parsed.type === 'C2S_THROW') {
        // 新增: 投掷物品消息
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        // 入队列，不立即处理
        const queue = throwQueues.get(playerId);
        if (queue) {
          queue.push({ targetX: parsed.targetX, targetY: parsed.targetY, itemType: parsed.itemType, ws });
          log('THROW_ENQUEUE', { player: playerId, targetX: parsed.targetX, targetY: parsed.targetY, itemType: parsed.itemType, tick: room.tick });
        }
      } else if (parsed.type === 'C2S_LOCAL_BULLET_HIT') {
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        const bullet =
          room.findBulletById(parsed.bulletId) ??
          room.findBulletByClientShotId(parsed.clientShotId, playerId);
        const serverSpawn = bullet && bullet.spawnX !== undefined ? `${bullet.spawnX.toFixed(1)},${bullet.spawnY.toFixed(1)}` : 'missing';
        log('LOCAL_BULLET_HIT_RECEIVED', {
          room: room.id,
          player: playerId,
          target: parsed.targetId,
          bullet: parsed.bulletId,
          clientShotId: parsed.clientShotId,
          spawn: `${parsed.spawnX.toFixed(1)},${parsed.spawnY.toFixed(1)}`,
        });
        console.log(`[LOCAL_BULLET_HIT] player=${playerId} target=${parsed.targetId} bullet=${parsed.bulletId} spawn=${parsed.spawnX.toFixed(1)},${parsed.spawnY.toFixed(1)} hit=${parsed.hitX.toFixed(1)},${parsed.hitY.toFixed(1)}`);
        if (!bullet) {
          log('LOCAL_BULLET_HIT_MISSING_BULLET', {
            room: room.id,
            player: playerId,
            bullet: parsed.bulletId,
            clientShotId: parsed.clientShotId,
          });
        }
        log('LOCAL_BULLET_HIT_REPORT', {
          room: room.id,
          player: playerId,
          target: parsed.targetId,
          bullet: parsed.bulletId,
          clientShotId: parsed.clientShotId,
          localSpawn: `${parsed.spawnX.toFixed(1)},${parsed.spawnY.toFixed(1)}`,
          serverSpawn,
          hit: `${parsed.hitX.toFixed(1)},${parsed.hitY.toFixed(1)}`,
          targetPos: `${parsed.targetX.toFixed(1)},${parsed.targetY.toFixed(1)}`,
          timestamp: parsed.timestamp,
        });
      } else if (parsed.type === 'C2S_PICKUP_WORLD_ITEM') {
        // 保留兼容（deprecated，建议用 C2S_INTERACT）
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
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
          sendError(ws, 'session.notAuthenticated');
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
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        // 使用 accountId 获取 Profile
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          sendError(ws, 'session.noAccount');
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
        
        // ✅ 修复：不仅发送 HIDEOUT，还要持久化 phase 状态
        // 否则后续操作（如购买物品）回发 Profile 时会因存储的 phase 仍为 NAME 而导致客户端弹回取名界面
        room.profileManager.updatePhase(accountId, 'HIDEOUT');
        
        // 发送更新后的 Profile
        sendProfile(ws, accountId);
      } else if (parsed.type === 'C2S_SELL_FROM_STASH') {
        // 新增: 处理从仓库卖出物品
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        // 使用 accountId 获取 Profile
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          sendError(ws, 'session.noAccount');
          return;
        }
        
        const result = room.profileManager.sellFromStash(accountId, parsed.iid, parsed.qty);
        if (!result.success) {
          sendError(ws, 'market.sellFailed');
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
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          sendError(ws, 'session.noAccount');
          return;
        }
        
        const profileBefore = room.profileManager.getProfileData(accountId);
        log('MOVE_STASH_TO_PREP_REQUEST', {
          room: room.id,
          player: playerId,
          accountId,
          iid: parsed.iid,
          qty: parsed.qty,
          phase: profileBefore.phase,
          prepItemsBefore: profileBefore.prep.length,
          tick: room.tick,
        });

        const result = room.profileManager.moveStashToPrep(accountId, parsed.iid, parsed.qty);
        if (!result.success) {
          log('MOVE_STASH_TO_PREP_FAILED', {
            room: room.id,
            player: playerId,
            accountId,
            errorCode: result.errorCode,
            tick: room.tick,
          });
          sendError(ws, result.errorCode);
        } else {
          const updatedProfile = room.profileManager.getProfileData(accountId);
          log('MOVE_STASH_TO_PREP_SUCCESS', {
            room: room.id,
            player: playerId,
            accountId,
            prepItemsAfter: updatedProfile.prep.length,
            tick: room.tick,
          });
          const phase = updatedProfile.displayName === null ? 'NAME' : 'HIDEOUT';
          sendProfile(ws, accountId, phase);
        }
      } else if (parsed.type === 'C2S_MOVE_PREP_TO_STASH') {
        // 新增: 处理从整备区移动回仓库
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          sendError(ws, 'session.noAccount');
          return;
        }
        
        const result = room.profileManager.movePrepToStash(accountId, parsed.iid, parsed.qty);
        if (!result.success) {
          sendError(ws, result.errorCode);
        } else {
          const updatedProfile = room.profileManager.getProfileData(accountId);
          const phase = updatedProfile.displayName === null ? 'NAME' : 'HIDEOUT';
          // 修复: 使用 sendProfile 函数，确保包含所有必需字段（包括 equipment）
          sendProfile(ws, accountId, phase);
        }
      } else if (parsed.type === 'C2S_BUY') {
        // 新增: 处理商店购买物品
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          sendError(ws, 'session.noAccount');
          return;
        }
        
        const result = room.profileManager.buyItem(accountId, parsed.typeId, parsed.qty, parsed.autoAction);
        if (!result.success) {
          sendError(ws, result.errorCode);
        } else {
          // ✅ 修复: 如果购买时自动装备了物品，需要同步到玩家实体（类似 C2S_EQUIP 的处理）
          if (parsed.autoAction === 'equip' && playerId) {
            const slot = parsed.typeId.startsWith('w_') ? 'weapon' : 
                        parsed.typeId.startsWith('bag_') ? 'bag' : 
                        parsed.typeId.startsWith('armor_') ? 'armor' : null;
            if (slot === 'weapon') {
              room.updatePlayerWeaponFromProfile(playerId, accountId);
              log('BUY_EQUIP_WEAPON_SYNC', { playerId, accountId, typeId: parsed.typeId });
            } else if (slot) {
              room.updatePlayerGearFromProfile(playerId, accountId);
              log('BUY_EQUIP_GEAR_SYNC', { playerId, accountId, typeId: parsed.typeId, slot });
            }
          }
          sendProfile(ws, accountId);
        }
      } else if (parsed.type === 'C2S_EQUIP') {
        // 新增: 处理装备/卸下装备
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          sendError(ws, 'session.noAccount');
          return;
        }
        
        const result = room.profileManager.equipItem(accountId, parsed.slot, parsed.iid);
        if (!result.success) {
          sendError(ws, result.errorCode);
        } else {
          // If the player is live, sync the equipped gear onto the entity.
          if (playerId) {
            if (parsed.slot === 'weapon') {
              room.updatePlayerWeaponFromProfile(playerId, accountId);
            } else {
              room.updatePlayerGearFromProfile(playerId, accountId);
            }
          }
          sendProfile(ws, accountId);
        }
      } else if (parsed.type === 'C2S_RAID_EQUIP') {
        // 新增: 处理局内装备切换
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }

        const result = room.handleRaidEquip(playerId, parsed.slot, parsed.iid, parsed.typeId ?? null);
        if (!result.success) {
          sendError(ws, result.errorCode);
        }
      } else if (parsed.type === 'C2S_DROP_ITEM') {
        // 新增: 处理局内丢弃物品
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }

        const result = room.handleDropItem(playerId, parsed.iid, parsed.qty);
        if (!result.success) {
          sendError(ws, result.errorCode);
        }
      } else if (parsed.type === 'C2S_ENTER_RAID') {
        // 新增: 处理进入战局
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          sendError(ws, 'session.noAccount');
          return;
        }
        
        const profile = room.profileManager.getProfileData(accountId);

        log('ENTER_RAID_REQUEST', {
          room: room.id,
          player: playerId,
          accountId,
          phase: profile.phase,
          prepItems: profile.prep.length,
          stashItems: profile.stash.length,
          tick: room.tick,
        });

        // 修复: 允许空整备进入（MVP 阶段先跑通流程）
        // 不再检查 prep 是否为空，允许玩家空手进入战局

        // 修复: 幂等操作 - 如果玩家已经在 raid 中且 phase 是 RAID，直接返回 profile
        const existingPlayer = room.players.get(playerId);
        if (existingPlayer && existingPlayer.status === 'ALIVE' && profile.phase === 'RAID') {
          // 玩家已经在 raid 中且活着，且phase已经是RAID，直接返回当前 profile
          sendProfile(ws, accountId, 'RAID');
          log('ENTER_RAID_IDEMPOTENT', {
            room: room.id,
            player: playerId,
            accountId: accountId,
            status: existingPlayer.status,
            phase: profile.phase,
          });
          return;
        }
        
        // 将 prep 移到 inventory（如果玩家不存在，先创建玩家）
        let player = existingPlayer;
        if (!player) {
          player = room.addPlayer(playerId, accountId);
        } else if (player.status !== 'ALIVE') {
          // 如果玩家已存在但不是ALIVE状态（DEAD 或 EXTRACTED），重新 spawn 并复活
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
          player.killedByWeapon = undefined;
          
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
                player.equippedWeaponItem = { ...weaponItem };
              } catch {
                // 无效武器类型，使用默认 FISTS
                const defaultWeaponDef = getWeaponDef('w_fists');
                player.weaponRuntime = {
                  weaponTypeId: 'w_fists',
                  ammoInMag: 0,
                  reloadingUntilTick: 0,
                  nextFireTick: room.tick,
                };
                player.equippedWeaponItem = null;
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
              player.equippedWeaponItem = null;
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
            player.equippedWeaponItem = null;
          }
          
          log('PLAYER_RESPAWN', {
            room: room.id,
            player: playerId,
            accountId: accountId,
            oldStatus: oldStatus,
            newStatus: 'ALIVE',
            tick: room.tick,
          });
        } else {
          // 玩家已存在且是ALIVE（首次进入对局，phase不是RAID）
          // 关键：清空inventory，避免重复物品
          const existingItemCount = player.inventory.items.length;
          player.clearInventory();

          log('ENTER_RAID_FIRST_TIME', {
            room: room.id,
            player: playerId,
            accountId: accountId,
            currentPhase: profile.phase,
            playerStatus: player.status,
            existingItemCount,
            tick: room.tick,
          });
        }

        // 进入战局前重置局内背包/护甲状态
        room.updatePlayerGearFromProfile(playerId, accountId);

        const equippedIids = new Set<string>();
        if (profile.equipment.weaponIid) equippedIids.add(profile.equipment.weaponIid);
        if (profile.equipment.bagIid) equippedIids.add(profile.equipment.bagIid);
        if (profile.equipment.armorIid) equippedIids.add(profile.equipment.armorIid);

        if (profile.prep.length > 0 && equippedIids.size > 0) {
          const stashIids = new Set(profile.stash.map(item => item.iid));
          const equipFromPrep = profile.prep.filter(item => equippedIids.has(item.iid));
          const moveToStash = equipFromPrep.filter(item => !stashIids.has(item.iid));
          if (moveToStash.length > 0) {
            room.profileManager.addToStash(accountId, moveToStash);
          }
        }

        // 将 prep 物品移到 inventory（允许空 prep）
        // 修复：使用 player.addItem() 正确处理堆叠和容量，避免物品丢失
        const prepItems = profile.prep.filter(item => !equippedIids.has(item.iid));
        const itemsNotAdded: typeof prepItems = [];

        log('LOAD_PREP_TO_INVENTORY', {
          room: room.id,
          player: playerId,
          accountId,
          inventoryItemsBefore: player.inventory.items.length,
          prepItemsTotal: profile.prep.length,
          prepItemsToLoad: prepItems.length,
          equippedCount: equippedIids.size,
          tick: room.tick,
        });

        for (const prepItem of prepItems) {
          const result = player.addItem(prepItem.typeId, prepItem.qty);

          log('ADD_PREP_ITEM', {
            room: room.id,
            player: playerId,
            typeId: prepItem.typeId,
            requested: prepItem.qty,
            added: result.added,
            tick: room.tick,
          });

          if (result.added < prepItem.qty) {
            // 部分或全部未添加，保留在 prep 中（避免物品丢失）
            const remaining = prepItem.qty - result.added;
            itemsNotAdded.push({
              iid: prepItem.iid,
              typeId: prepItem.typeId,
              qty: remaining,
            });
            log('PREP_ITEM_NOT_FIT', {
              typeId: prepItem.typeId,
              requested: prepItem.qty,
              added: result.added,
              remaining,
            });
          }
        }

        // 只清空成功添加的物品，保留未添加的物品在 prep 中
        room.profileManager.updateProfile(accountId, { prep: itemsNotAdded });

        log('PREP_LOADED_TO_INVENTORY', {
          room: room.id,
          player: playerId,
          accountId,
          inventoryItemCount: player.inventory.items.length,
          itemsNotAdded: itemsNotAdded.length,
          tick: room.tick,
        });

        // ✅ 关键：进入 RAID 时更新 phase 为 'RAID'（持久化）
        room.profileManager.updatePhase(accountId, 'RAID');

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
          sendError(ws, 'session.adminDisabled');
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
          sendEvent(ws, 'cmd.status', {
            tick: room.tick,
            players: room.players.size,
            seed: room.seed,
          });
        } else if (parsed.command === 'reset_world') {
          // 通知所有客户端即将重置
          for (const [clientWs] of connections.entries()) {
            try {
              sendEvent(clientWs, 'event.server.resetting');
            } catch (err) {
              // 忽略发送失败
            }
          }
          
          // 延迟100ms后重置（给客户端时间显示消息）
          setTimeout(() => {
            admin.resetRoom();
          }, 100);
        }
      } else if (parsed.type === 'C2S_EXIT_RESULT') {
        // ✅ 新增: 处理退出结果页面（从 RESULT 阶段返回 HIDEOUT）
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
        }
        
        const accountId = wsToAccountId.get(ws);
        if (!accountId) {
          sendError(ws, 'session.noAccount');
          return;
        }
        
        // ✅ 修复：直接使用 profileManager.updatePhase，不需要通过 room.handleExitResult
        // 因为玩家死亡后 playerToAccount 映射已被清理
        room.profileManager.updatePhase(accountId, 'HIDEOUT');
        
        // 发送更新的 Profile（phase=HIDEOUT）
        sendProfile(ws, accountId);
        
        log('EXIT_RESULT_HANDLED', {
          room: room.id,
          player: playerId,
          accountId: accountId,
          tick: room.tick,
        });
      } else if (parsed.type === 'C2S_INPUT') {
        if (!playerId) {
          sendError(ws, 'session.notAuthenticated');
          return;
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

      sendError(ws, 'session.badRequest');
    }
  });

  ws.on('close', () => {
    if (playerId) {
      const accountId = wsToAccountId.get(ws);

      // 简化逻辑：断线即死亡
      // 如果在RAID中，处理死亡逻辑（清空prep，phase改为HIDEOUT）
      if (accountId) {
        room.profileManager.handleDisconnectDeath(accountId);
      }

      // 清理玩家实体
      room.removePlayer(playerId);

      // 清理所有映射
      connections.delete(ws);
      wsToAccountId.delete(ws);
      playerIdToAccountId.delete(playerId);

      log('PLAYER_DISCONNECT', {
        room: room.id,
        player: playerId,
        accountId: accountId,
        tick: room.tick,
      });
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

  // 更新所有玩家的短效 Buff（基于当前 tick）
  for (const player of room.players.values()) {
    player.updateBuffs(room.tick);
  }

  // 新增: 更新需要读条的道具使用（例如急救包）
  room.updateItemUsages();

  // 新增: 记录本tick有输入的玩家（避免重复更新耐力）
  const playersWithInput = new Set<string>();

  // Day2: 先处理输入（可能生成子弹）
  // 修复: 按序处理最多 N 条，避免队列为空时不移动（解决 err=10 问题）
  const MAX_STEPS = 4; // 每 tick 最多追 4 步，避免被恶意灌爆
  for (const [playerId, queue] of inputQueues.entries()) {
    if (queue.length === 0) {
      continue;
    }
    
    // 标记该玩家本tick有输入
    playersWithInput.add(playerId);
    
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
    // 修复: 在每次 processInput 后立即记录位置历史，提高采样率
    const now = Date.now();
    for (let i = 0; i < slice.length; i++) {
      const raw = slice[i].input;
      const isLast = i === slice.length - 1;
      room.processInput(playerId, {
        ...raw,
        // 只在最后一条处理一次性事件，避免重复触发
        interact: isLast ? aggregatedInteract : false,
        extract: isLast ? aggregatedExtract : false,
      });

      // 修复: 每处理完一个输入后立即记录位置（提高采样率到约 80Hz）
      const player = room.players.get(playerId);
      if (player) {
        player.positionHistory.add(room.tick, now + i, player.x, player.y);
      }
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
        if (lastReq.ws.readyState === WebSocket.OPEN) {
          sendError(lastReq.ws, result.errorCode);
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
          reason: result.errorCode,
          playerPos: player ? `(${player.x.toFixed(1)},${player.y.toFixed(1)})` : 'N/A',
          tick: room.tick,
        });
        if (lastReq.ws.readyState === WebSocket.OPEN) {
          sendError(lastReq.ws, result.errorCode);
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
          reason: result.errorCode,
          playerPos: player ? `(${player.x.toFixed(1)},${player.y.toFixed(1)})` : 'N/A',
          tick: room.tick,
        });
        if (lastReq.ws.readyState === WebSocket.OPEN) {
          sendError(lastReq.ws, result.errorCode);
        }
      } else {
        log('PICKUP_OK', { player: playerId, type: 'bag', bid: lastReq.bid, tick: room.tick });
      }
    }
    
    // 清空队列
    queue.length = 0;
  }
  
  // 新增: 处理使用物品队列（快捷栏1-5键）
  for (const [playerId, queue] of useItemQueues.entries()) {
    if (queue.length === 0) continue;
    
    // 只处理最后一个请求（避免重复使用）
    const lastReq = queue[queue.length - 1];
    
    const result = room.handleUseItem(playerId, lastReq.slot);
    if (!result.success) {
      if (lastReq.ws.readyState === WebSocket.OPEN) {
        sendError(lastReq.ws, result.errorCode);
      }
    } else {
      log('USE_ITEM_OK', { player: playerId, slot: lastReq.slot, itemType: result.itemType, tick: room.tick });
    }
    
    // 清空队列
    queue.length = 0;
  }
  
  // 新增: 处理投掷队列
  for (const [playerId, queue] of throwQueues.entries()) {
    if (queue.length === 0) continue;
    
    // 只处理最后一个请求（避免重复投掷）
    const lastReq = queue[queue.length - 1];
    console.log(`[server/main] handleThrow: playerId=${playerId}, itemType="${lastReq.itemType}", targetX=${lastReq.targetX.toFixed(2)}, targetY=${lastReq.targetY.toFixed(2)}`);
    
    const result = room.handleThrow(playerId, lastReq.targetX, lastReq.targetY, lastReq.itemType);
    if (!result.success) {
      if (lastReq.ws.readyState === WebSocket.OPEN) {
        sendError(lastReq.ws, result.errorCode);
      }
    } else {
      log('THROW_OK', { player: playerId, targetX: lastReq.targetX, targetY: lastReq.targetY, itemType: lastReq.itemType, tick: room.tick });
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
    const player = room.players.get(playerId);
    log('RAID_RESULT_PROCESSING', {
      room: room.id,
      player: playerId,
      playerStatus: player?.status ?? 'UNKNOWN',
      result: result.result,
      playerCount: room.players.size,
      tick: room.tick,
    });
    const ws = Array.from(connections.entries()).find(([, pid]) => pid === playerId)?.[0];
    
    // 调试日志：检查 WebSocket 连接状态
    log('RAID_RESULT_WS_CHECK', {
      room: room.id,
      player: playerId,
      wsFound: ws ? 'yes' : 'no',
      wsReadyState: ws?.readyState ?? 'N/A',
      wsOpen: ws?.readyState === WebSocket.OPEN ? 'yes' : 'no',
      connectionsCount: connections.size,
      tick: room.tick,
    });
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      // ✅ 关键：raid 结束时更新 phase 为 'RESULT'（持久化）
      room.profileManager.updatePhase(result.accountId, 'RESULT', () => {
        // 清理 accountId → playerId 映射
        accountIdToPlayerId.delete(result.accountId);
        log('CLEANUP_RAID_MAPPING', {
          room: room.id,
          accountId: result.accountId,
          tick: room.tick,
        });
      });

      // 发送 S2C_RAID_RESULT
      ws.send(
        JSON.stringify(
          S2C_RAID_RESULT_SCHEMA.parse({
            type: 'S2C_RAID_RESULT',
            result: result.result,
            loot: result.loot ?? [],
            moneyGained: result.moneyGained ?? 0,
            moneyLost: result.moneyLost ??0,
            killedBy: result.killedBy,
            killedByWeapon: result.killedByWeapon,
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
    // Clean up the raid entity after results are delivered to avoid stale players lingering.
    log('RAID_RESULT_CLEANUP_PENDING', {
      room: room.id,
      player: playerId,
      playerStatus: player?.status ?? 'UNKNOWN',
      result: result.result,
      tick: room.tick,
    });
    room.removePlayer(playerId);
    playerLatencies.delete(playerId);
    lastProfileSentTick.delete(playerId);
    lastExtractedInventoryCount.delete(playerId);
    log('RAID_RESULT_ENTITY_CLEANED', {
      room: room.id,
      player: playerId,
      accountId: result.accountId,
      result: result.result,
      tick: room.tick,
    });
    room.raidResults.delete(playerId);
  }

  // 新增: 更新所有玩家的撤离进度（每 tick 自动检查，不依赖输入）
  room.updateExtractProgress();
  
  // 新增: 更新所有玩家的武器状态（处理换弹完成）
  for (const playerId of room.players.keys()) {
    room.updateWeaponRuntime(playerId);
  }

  // 延迟补偿: 记录所有玩家的位置历史（在移动更新之后，子弹更新之前）
  const now = Date.now();
  for (const [playerId, player] of room.players.entries()) {
    player.positionHistory.add(room.tick, now, player.x, player.y);
  }

  // 延迟补偿: 将延迟数据转换为简单映射传递给 updateBullets
  const latencyMap = new Map<string, number>();
  for (const [playerId, latency] of playerLatencies.entries()) {
    latencyMap.set(playerId, latency.rtt);
  }

  // 更新AI（行为、寻路、战斗）
  room.updateAIs(room.tick);
  
  // 新增: 更新炮塔
  room.updateTurrets(0.05);

  // 新增: 更新伪装玩家的AI行为（枪口摆动和状态检测）
  const allPlayersArray = Array.from(room.players.values());
  for (const player of allPlayersArray) {
    if (player.isDisguised()) {
      player.updateDisguisedAiBehavior(allPlayersArray, room.tick);
    }
  }

  // 新增: 检查并执行物品和AI重刷
  room.checkAndRespawnItems();
  room.checkAndRespawnAIs();

  // Day2: 更新子弹位置并检测命中（20Hz tick = 50ms = 0.05s）
  const deltaTime = 0.05;
  room.updateBullets(deltaTime, latencyMap);

  // 新增: 更新烟雾生命周期（清理过期烟雾）
  room.updateSmokes();

  // 新增: 更新燃烧区域（清理过期 + 造成伤害）
  room.updateFires(0.05);

  // 新增: 更新障碍物状态（清理被破坏的障碍物）
  room.updateObstacles();

  // 新增: 更新诱饵状态
  room.updateDecoys(0.05);

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

  // 广播近战挥击事件（用于显示其他玩家挥击）
  const meleeSwings = room.drainMeleeSwings();
  if (meleeSwings.length > 0) {
    for (const swing of meleeSwings) {
      const message = S2C_MELEE_SWING_SCHEMA.parse({
        type: 'S2C_MELEE_SWING',
        playerId: swing.playerId,
        x: swing.x,
        y: swing.y,
        aimRad: swing.aimRad,
        range: swing.range,
        arcRad: swing.arcRad,
        weaponTypeId: swing.weaponTypeId, // 传递武器类型
      });

      for (const ws of connections.keys()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      }
    }
  }

  // 广播爆炸事件（用于视觉效果）
  const explosions = room.drainExplosions();
  if (explosions.length > 0) {
    for (const explosion of explosions) {
      log('EXPLOSION_BROADCAST', {
        room: room.id,
        x: explosion.x,
        y: explosion.y,
        radius: explosion.radius,
        tick: room.tick,
      });
      const message = S2C_EXPLOSION_SCHEMA.parse({
        type: 'S2C_EXPLOSION',
        x: explosion.x,
        y: explosion.y,
        radius: explosion.radius,
      });

      for (const ws of connections.keys()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      }
    }
  }

  // 新增: 广播烟雾事件（用于渲染烟雾区域）
  const smokes = room.drainSmokes();
  if (smokes.length > 0) {
    for (const smoke of smokes) {
      const message = S2C_SMOKE_SCHEMA.parse({
        type: 'S2C_SMOKE',
        x: smoke.x,
        y: smoke.y,
        radius: smoke.radius,
        durationMs: smoke.durationMs,
      });

      for (const ws of connections.keys()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      }
    }
  }

  // 新增: 广播燃烧事件（用于渲染燃烧区域）
  const fires = room.drainFires();
  if (fires.length > 0) {
    for (const fire of fires) {
      const message = S2C_FIRE_SCHEMA.parse({
        type: 'S2C_FIRE',
        x: fire.x,
        y: fire.y,
        radius: fire.radius,
        durationMs: fire.durationMs,
      });

      for (const ws of connections.keys()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      }
    }
  }

  // 新增: 单播局内自动装备回执（只有当事玩家需要知道）
  const autoEquips = room.drainAutoEquips();
  for (const notice of autoEquips) {
    const targetWs = Array.from(connections.entries()).find(([, pid]) => pid === notice.playerId)?.[0];
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(
        JSON.stringify(
          S2C_AUTO_EQUIP_SCHEMA.parse({
            type: 'S2C_AUTO_EQUIP',
            playerId: notice.playerId,
            slot: notice.slot,
            itemTypeId: notice.itemTypeId,
          })
        )
      );
    }
  }

  // 新增: 广播击杀播报
  const killFeeds = room.drainKillFeeds();
  if (killFeeds.length > 0) {
    for (const feed of killFeeds) {
       const message = S2C_KILL_FEED_SCHEMA.parse({
         type: 'S2C_KILL_FEED',
         killer: feed.killer,
         victim: feed.victim,
         weapon: feed.weapon,
       });

       for (const ws of connections.keys()) {
         if (ws.readyState === WebSocket.OPEN) {
           ws.send(JSON.stringify(message));
         }
       }
    }
  }

  // Broadcast World Events (Event-Driven Updates)
  const worldEvents = room.drainWorldEvents();
  if (worldEvents.length > 0) {
    for (const event of worldEvents) {
      const msgString = JSON.stringify(event);
      for (const ws of connections.keys()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(msgString);
        }
      }
    }
  }

  // 新增: 为没有输入的玩家更新耐力（确保不动时也能恢复耐力）
  for (const [playerId, player] of room.players.entries()) {
    if (player.status === 'ALIVE' && !playersWithInput.has(playerId)) {
      // 玩家本tick没有输入，手动更新耐力（不移动，不冲刺）
      player.updateStamina(0.05, false, false); // deltaTime=0.05秒（20Hz）
    }
  }

}, TICK_INTERVAL_MS);

// Snapshot 广播循环（10Hz）
let lastSnapshotLogTick = 0;

setInterval(() => {
  // 调试日志：每200 tick（约10秒）打印一次快照大小和内容摘要
  if (room.tick - lastSnapshotLogTick >= 200 && connections.size > 0) {
    lastSnapshotLogTick = room.tick;
    
    // 获取一个通用快照用于调试（不带 playerId）
    const debugSnapshot = room.getSnapshot();
    const debugMessage = {
      type: 'S2C_SNAPSHOT',
      tick: room.tick,
      timestamp: Date.now(),
      ...debugSnapshot,
    };
    const debugJsonString = JSON.stringify(debugMessage);
    
    // 估算压缩后大小
    const compressed = deflateSync(Buffer.from(debugJsonString));
    const compressionRatio = ((1 - compressed.length / debugJsonString.length) * 100).toFixed(0);
    
    console.log(`\n========== SNAPSHOT DEBUG (tick=${room.tick}) ==========`);
    console.log(`📦 JSON Size: ${(debugJsonString.length / 1024).toFixed(2)} KB`);
    console.log(`🗜️ Compressed: ${(compressed.length / 1024).toFixed(2)} KB (${compressionRatio}% smaller)`);
    console.log(`👤 Players: ${debugSnapshot.players.length}`);
    console.log(`🤖 AIs: ${debugSnapshot.ais.length}`);
    console.log(`🔫 Bullets: ${debugSnapshot.bullets.length}`);
    console.log(`🎯 Decoys: ${debugSnapshot.decoys.length}`);
    console.log(`🗼 Turrets: ${debugSnapshot.turrets.length}`);
    console.log(`\n--- Full Snapshot JSON ---`);
    console.log(debugJsonString);
    console.log(`==========================================\n`);
  }

  // ✅ 优化: 按玩家发送快照，每个玩家收到包含自己 inventory 的版本
  // 注意: 不使用 S2C_SNAPSHOT_SCHEMA.parse()，因为 zod 会填回所有 .default() 字段
  for (const [ws, playerId] of connections.entries()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    
    const snapshot = room.getSnapshot(playerId);
    // 直接构造消息，保持精简的字段结构
    const message = {
      type: 'S2C_SNAPSHOT' as const,
      tick: room.tick,
      timestamp: Date.now(),
      players: snapshot.players,
      bullets: snapshot.bullets,
      items: snapshot.items,
      worldItems: snapshot.worldItems,
      lootBags: snapshot.lootBags,
      obstacles: snapshot.obstacles,
      ais: snapshot.ais,
      decoys: snapshot.decoys,
      turrets: snapshot.turrets,
    };
    
    // 使用 MessagePack 二进制编码发送
    ws.send(encodeMessage(message));
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
      key: event.key,
      params: event.params,
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

httpServer.listen(PORT, HOST);

log('Server listening', {
  room: room.id,
  tick: 0,
  host: HOST,
  port: PORT.toString(),
  clientDir: CLIENT_DIR,
  mapTemplate: activeMapTemplateId ?? 'random',
  mapTemplateId: room.mapTemplateId ?? 'N/A',
  seed: room.seed.toString(),
});
