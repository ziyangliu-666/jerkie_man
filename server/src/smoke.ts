import { WebSocket } from 'ws';
import {
  C2S_HELLO_SCHEMA,
  C2S_INPUT_SCHEMA,
  S2C_MESSAGE_SCHEMA,
  type S2C_SNAPSHOT,
} from '@jerkie-man/shared';

const SERVER_URL = 'ws://localhost:8080';
const TEST_DURATION_MS = 2000; // 2秒测试

interface TestClient {
  ws: WebSocket;
  id: string;
  snapshots: S2C_SNAPSHOT[];
  connected: boolean;
  playerId: string | null; // 服务器分配的playerId
}

async function createClient(id: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    const client: TestClient = {
      ws,
      id,
      snapshots: [],
      connected: false,
      playerId: null,
    };

    ws.on('open', () => {
      // 发送HELLO
      ws.send(
        JSON.stringify(
          C2S_HELLO_SCHEMA.parse({
            type: 'C2S_HELLO',
            room: 'local',
          })
        )
      );
    });

    ws.on('message', (data: Buffer) => {
      try {
        const raw = JSON.parse(data.toString());
        
        // 处理S2C_WELCOME消息
        if (raw.type === 'S2C_WELCOME' && raw.playerId) {
          client.playerId = raw.playerId;
          console.log(`[${id}] Received welcome, playerId: ${client.playerId}`);
          return;
        }

        const message = S2C_MESSAGE_SCHEMA.parse(raw);

        if (message.type === 'S2C_SNAPSHOT') {
          client.snapshots.push(message);
        }
      } catch (error) {
        console.error(`[${id}] Failed to parse message:`, error);
      }
    });

    ws.on('error', (error) => {
      reject(new Error(`[${id}] WebSocket error: ${error.message}`));
    });

    // 等待连接建立
    setTimeout(() => {
      client.connected = ws.readyState === WebSocket.OPEN;
      resolve(client);
    }, 100);
  });
}

async function runSmokeTest(): Promise<void> {
  console.log('Starting smoke test...');
  console.log(`Connecting to ${SERVER_URL}`);

  // 创建两个客户端
  const client1 = await createClient('client1');
  const client2 = await createClient('client2');

  console.log(`Client1 connected: ${client1.connected}`);
  console.log(`Client2 connected: ${client2.connected}`);

  if (!client1.connected || !client2.connected) {
    throw new Error('Failed to connect clients');
  }

  // 等待初始snapshot
  await new Promise((resolve) => setTimeout(resolve, 200));

  // 等待第一个snapshot以获取初始tick
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 发送输入（模拟移动）
  let inputSeq = 0;
  let lastTick = 0;
  if (client1.snapshots.length > 0) {
    lastTick = client1.snapshots[client1.snapshots.length - 1].tick;
  }

  const sendInterval = setInterval(() => {
    inputSeq++;
    lastTick++; // 估计当前tick

    // Client1: 向右移动
    if (client1.ws.readyState === WebSocket.OPEN) {
      client1.ws.send(
        JSON.stringify(
          C2S_INPUT_SCHEMA.parse({
            type: 'C2S_INPUT',
            seq: inputSeq,
            tick: lastTick,
            keys: { up: false, down: false, left: false, right: true },
            aim: 0,
          })
        )
      );
    }

    // Client2: 向上移动
    if (client2.ws.readyState === WebSocket.OPEN) {
      client2.ws.send(
        JSON.stringify(
          C2S_INPUT_SCHEMA.parse({
            type: 'C2S_INPUT',
            seq: inputSeq,
            tick: lastTick,
            keys: { up: true, down: false, left: false, right: false },
            aim: 0,
          })
        )
      );
    }
  }, 50); // 每50ms发送一次（20Hz）

  // 运行2秒
  await new Promise((resolve) => setTimeout(resolve, TEST_DURATION_MS));
  clearInterval(sendInterval);

  // 关闭连接
  client1.ws.close();
  client2.ws.close();

  // 等待最后的消息
  await new Promise((resolve) => setTimeout(resolve, 200));

  // 验证结果
  console.log('\n=== Test Results ===');
  console.log(`Client1 snapshots received: ${client1.snapshots.length}`);
  console.log(`Client2 snapshots received: ${client2.snapshots.length}`);

  // 断言：至少收到多次snapshot
  if (client1.snapshots.length < 5) {
    throw new Error(`Client1 received too few snapshots: ${client1.snapshots.length}`);
  }
  if (client2.snapshots.length < 5) {
    throw new Error(`Client2 received too few snapshots: ${client2.snapshots.length}`);
  }

  // 断言：snapshot包含至少2个玩家
  const lastSnapshot1 = client1.snapshots[client1.snapshots.length - 1];
  const lastSnapshot2 = client2.snapshots[client2.snapshots.length - 1];

  if (lastSnapshot1.players.length < 2) {
    throw new Error(
      `Client1 last snapshot has too few players: ${lastSnapshot1.players.length}`
    );
  }
  if (lastSnapshot2.players.length < 2) {
    throw new Error(
      `Client2 last snapshot has too few players: ${lastSnapshot2.players.length}`
    );
  }

  // 断言：tick递增
  const ticks1 = client1.snapshots.map((s) => s.tick);
  const ticks2 = client2.snapshots.map((s) => s.tick);

  for (let i = 1; i < ticks1.length; i++) {
    if (ticks1[i] <= ticks1[i - 1]) {
      throw new Error(`Client1 tick not increasing: ${ticks1[i - 1]} -> ${ticks1[i]}`);
    }
  }
  for (let i = 1; i < ticks2.length; i++) {
    if (ticks2[i] <= ticks2[i - 1]) {
      throw new Error(`Client2 tick not increasing: ${ticks2[i - 1]} -> ${ticks2[i]}`);
    }
  }

  // 断言：至少一个玩家坐标发生变化（1.5s内移动距离>10px）
  const firstSnapshot1 = client1.snapshots[0];
  if (firstSnapshot1.players.length === 0) {
    throw new Error('No players in first snapshot');
  }

  // 找到client1对应的玩家
  const player1First = firstSnapshot1.players.find((p) => p.id === client1.playerId);
  if (!player1First) {
    throw new Error(`Client1 player (${client1.playerId}) not found in first snapshot`);
  }

  const player1Last = lastSnapshot1.players.find((p) => p.id === client1.playerId);
  if (!player1Last) {
    throw new Error(`Client1 player (${client1.playerId}) not found in last snapshot`);
  }

  const dx = player1Last.x - player1First.x;
  const dy = player1Last.y - player1First.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  console.log(`\n=== Movement Analysis ===`);
  console.log(`PlayerId: ${client1.playerId}`);
  console.log(`Initial position: (${player1First.x.toFixed(2)}, ${player1First.y.toFixed(2)})`);
  console.log(`Final position: (${player1Last.x.toFixed(2)}, ${player1Last.y.toFixed(2)})`);
  console.log(`Distance moved: ${distance.toFixed(2)}px`);

  if (distance < 10) {
    throw new Error(
      `Player movement too small: ${distance.toFixed(2)}px < 10px. PlayerId: ${client1.playerId}`
    );
  }

  console.log('✓ All assertions passed!');
  console.log(`✓ Tick range: ${ticks1[0]} -> ${ticks1[ticks1.length - 1]}`);
}

// 运行测试
runSmokeTest()
  .then(() => {
    console.log('\n✅ Smoke test PASSED');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Smoke test FAILED:', error.message);
    process.exit(1);
  });

