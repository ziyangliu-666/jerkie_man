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
              items: room.getItems(),
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
  // Day3 修复B: 使用最新的 movement/aim/shoot，但对 interact/extract 做 OR 聚合
  for (const [playerId, queue] of inputQueues.entries()) {
    if (queue.length === 0) continue;
    
    // 按seq排序，只处理最新的一个（避免积压导致越跑越慢）
    queue.sort((a, b) => b.input.seq - a.input.seq); // 降序，最新的在前
    const latest = queue.shift();
    if (latest) {
      // Day3 修复B: 聚合队列中所有 input 的 interact/extract（OR 操作）
      let aggregatedInteract = latest.input.interact ?? false;
      let aggregatedExtract = latest.input.extract ?? false;
      
      for (const entry of queue) {
        if (entry.input.interact) aggregatedInteract = true;
        if (entry.input.extract) aggregatedExtract = true;
      }
      
      // 使用最新的 input，但替换 interact/extract 为聚合值
      const aggregatedInput = {
        ...latest.input,
        interact: aggregatedInteract,
        extract: aggregatedExtract,
      };
      
      room.processInput(playerId, aggregatedInput);
    }
    
    // 清空队列（只保留最新输入）
    queue.length = 0;
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
    items: snapshot.items,
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

