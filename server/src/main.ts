import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room.js';
import { log } from './logger.js';
import {
  C2S_MESSAGE_SCHEMA,
  S2C_SNAPSHOT_SCHEMA,
  S2C_ERROR_SCHEMA,
  type C2S_MESSAGE,
} from '@jerkie-man/shared';

const PORT = 8080;
const TICK_INTERVAL_MS = 50; // 20Hz
const SNAPSHOT_INTERVAL_MS = 100; // 10Hz

const wss = new WebSocketServer({ port: PORT });
const room = new Room('local');

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
const inputQueues = new Map<string, Array<{ input: C2S_MESSAGE & { type: 'C2S_INPUT' }; ws: WebSocket }>>();

wss.on('connection', (ws: WebSocket) => {
  let playerId: string | null = null;

  ws.on('message', (data: Buffer) => {
    try {
      const raw = JSON.parse(data.toString());
      const parsed = C2S_MESSAGE_SCHEMA.parse(raw);

      if (parsed.type === 'C2S_HELLO') {
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

        // 将输入加入队列（tick循环会处理）
        const queue = inputQueues.get(playerId);
        if (queue) {
          queue.push({ input: parsed, ws });
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

  // 处理所有输入队列
  for (const [playerId, queue] of inputQueues.entries()) {
    // 按seq排序，处理最新的
    queue.sort((a, b) => a.input.seq - b.input.seq);
    while (queue.length > 0) {
      const { input } = queue.shift()!;
      room.processInput(playerId, input);
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
    items: snapshot.items,
  });

  // 广播给所有连接
  for (const ws of connections.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}, SNAPSHOT_INTERVAL_MS);

log('Server listening', {
  room: room.id,
  tick: 0,
  port: PORT.toString(),
});

