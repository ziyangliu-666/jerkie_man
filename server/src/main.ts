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
  type C2S_MESSAGE,
} from '@jerkie-man/shared';

// 支持从环境变量读取端口（CI友好）
const PORT = Number(process.env.PORT) || 8080;
const TICK_INTERVAL_MS = 50; // 20Hz
const SNAPSHOT_INTERVAL_MS = 100; // 10Hz

const wss = new WebSocketServer({ port: PORT });
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

// 输入队列（按playerId组织）
// 队列保护：最大长度32，超过时丢弃旧的
const INPUT_QUEUE_MAX_LENGTH = 32;
const inputQueues = new Map<string, Array<{ input: C2S_MESSAGE & { type: 'C2S_INPUT' }; ws: WebSocket }>>();
let lastQueueWarnTime = 0;

// P2-3: Pickup 队列（入队列 tick 处理，确保移动和拾取对齐）
type PickupReq = 
  | { type: 'world'; wid: string; ws: WebSocket }
  | { type: 'bag'; bid: string; ws: WebSocket };
const pickupQueues = new Map<string, PickupReq[]>();

// P1-1 修复: lastProfileSentTick 移至模块级，避免每 tick 重新创建导致重复发送
const lastProfileSentTick = new Map<string, number>();
// 新增: 记录玩家撤离时的背包物品数（用于判断"刚完成撤离"）
const lastExtractedInventoryCount = new Map<string, number>();

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
            
            // 分配玩家ID
            playerId = `p${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            connections.set(ws, playerId);
            room.addPlayer(playerId);
            inputQueues.set(playerId, []);
            pickupQueues.set(playerId, []); // P2-3: 初始化 pickup 队列

        log('CONNECT', {
          room: room.id,
          player: playerId,
          tick: room.tick,
        });

        // Day4-1: 发送WELCOME消息，告知客户端自己的playerId和世界配置
        ws.send(
          JSON.stringify(
            S2C_WELCOME_SCHEMA.parse({
              type: 'S2C_WELCOME',
              playerId: playerId,
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
        const initialProfile = room.profileManager.getProfileData(playerId);
        ws.send(
          JSON.stringify(
            S2C_PROFILE_SCHEMA.parse({
              type: 'S2C_PROFILE',
              money: initialProfile.money,
              stash: initialProfile.stash,
              bagCap: initialProfile.bagCap,
            })
          )
        );
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
      } else if (parsed.type === 'C2S_PICKUP_WORLD_ITEM') {
        // P2-3: 拾取改成入队列，在 tick 中处理（确保移动和拾取对齐）
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
        // P2-3: 拾取改成入队列，在 tick 中处理（确保移动和拾取对齐）
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
        const result = room.profileManager.sellFromStash(playerId, parsed.iid, parsed.qty);
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
            iid: parsed.iid,
            qty: parsed.qty,
            money: result.money,
            tick: room.tick,
          });
          
          // 卖出成功后立即发送 Profile（不然 client HUD 不刷新）
          const updatedProfile = room.profileManager.getProfileData(playerId);
          ws.send(
            JSON.stringify(
              S2C_PROFILE_SCHEMA.parse({
                type: 'S2C_PROFILE',
                money: updatedProfile.money,
                stash: updatedProfile.stash,
                bagCap: updatedProfile.bagCap,
              })
            )
          );
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
    
    if (lastReq.type === 'world') {
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
    } else {
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
          const profile = room.profileManager.getProfileData(playerId);
          ws.send(
            JSON.stringify(
              S2C_PROFILE_SCHEMA.parse({
                type: 'S2C_PROFILE',
                money: profile.money,
                stash: profile.stash,
                bagCap: profile.bagCap,
              })
            )
          );
          lastProfileSentTick.set(playerId, room.tick);
        }
      }
      
      // 更新记录的背包数量
      lastExtractedInventoryCount.set(playerId, player.inventory.items.length);
    }
  }

  // Day2: 更新子弹位置并检测命中（20Hz tick = 50ms = 0.05s）
  const deltaTime = 0.05;
  room.updateBullets(deltaTime);

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
  port: PORT.toString(),
});

