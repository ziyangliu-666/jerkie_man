# 玩家移动问题修复 - 详细Diff

## 修复概述

修复了玩家移动检测失败的问题，包括DPR/坐标转换bug、本地玩家识别问题和输入处理策略优化。

## 文件修改列表

### 1. `client/src/renderer.ts`

**问题**: DPR缩放导致坐标转换错误，重复scale导致坐标错位

**修复**:
```diff
  private setupCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

-   // 缩放上下文以匹配DPI
-   this.ctx.scale(dpr, dpr);
+   // 重置transform，然后设置scale（避免重复scale）
+   this.ctx.resetTransform();
+   this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = dpr;
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
-     x: (screenX - rect.left) / this.scale,
-     y: (screenY - rect.top) / this.scale,
+     x: screenX - rect.left,
+     y: screenY - rect.top,
    };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
-     x: worldX * this.scale + rect.left,
-     y: worldY * this.scale + rect.top,
+     x: worldX + rect.left,
+     y: worldY + rect.top,
    };
  }

  render(players: PLAYER_STATE[], localPlayerId: string | null): void {
    this.clear();
    for (const player of players) {
      this.drawPlayer(player, player.id === localPlayerId);
    }
+   // 临时调试：显示本地玩家坐标文本
+   if (localPlayerId) {
+     const localPlayer = players.find((p) => p.id === localPlayerId);
+     if (localPlayer) {
+       this.ctx.fillStyle = '#fff';
+       this.ctx.font = '12px monospace';
+       this.ctx.fillText(
+         `Local: (${localPlayer.x.toFixed(1)}, ${localPlayer.y.toFixed(1)})`,
+         10,
+         20
+       );
+     }
+   }
  }
```

### 2. `client/src/network.ts`

**问题**: 无法识别服务器分配的playerId

**修复**:
```diff
  export interface NetworkCallbacks {
    onSnapshot?: (snapshot: S2C_SNAPSHOT) => void;
    onError?: (error: string) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
+   onWelcome?: (playerId: string) => void;
  }

  this.ws.onmessage = (event) => {
    try {
      const raw = JSON.parse(event.data.toString());
      
+     // 处理S2C_WELCOME消息（不在schema中，需要特殊处理）
+     if (raw.type === 'S2C_WELCOME' && raw.playerId) {
+       if (this.callbacks.onWelcome) {
+         this.callbacks.onWelcome(raw.playerId);
+       }
+       return;
+     }
+
      const message = S2C_MESSAGE_SCHEMA.parse(raw) as S2C_MESSAGE;
      // ...
    }
  }
```

### 3. `client/src/main.ts`

**问题**: 使用players[0]假设本地玩家，不准确

**修复**:
```diff
  const network = new Network('ws://localhost:8080', 'local', {
    onConnect: () => {
      console.log('Connected to server');
      hud.addEvent('Connected to server');
    },
+   onWelcome: (playerId: string) => {
+     localPlayerId = playerId;
+     console.log(`Received welcome, local player ID: ${localPlayerId}`);
+     hud.addEvent(`Local player ID: ${localPlayerId}`);
+   },
    onSnapshot: (snapshot: S2C_SNAPSHOT) => {
-     // 从第一个snapshot中确定本地玩家ID（简单策略：第一个玩家）
-     if (localPlayerId === null && snapshot.players.length > 0) {
-       localPlayerId = snapshot.players[0]?.id ?? null;
-       if (localPlayerId) {
-         hud.addEvent(`Local player ID: ${localPlayerId}`);
-       }
-     }
      // 更新选中实体的数据（如果已选中）
      if (selectedEntity) {
        const updated = snapshot.players.find((p) => p.id === selectedEntity!.id);
        if (updated) {
          selectedEntity = updated;
        }
      }
    },
  });

+ // 节流日志：每200ms打印一次
+ let lastLogTime = 0;
  function renderLoop(): void {
    // ...
    inputSeq++;
    network.sendInput(inputSeq, keys, aim);
+
+   // 节流日志：每200ms打印一次
+   const now = Date.now();
+   if (now - lastLogTime >= 200) {
+     const connState = network.getConnectionState();
+     console.log(`[CLIENT] seq=${inputSeq} tick=${connState.lastServerTick} keys=${JSON.stringify(keys)}`);
+     lastLogTime = now;
+   }
  }
```

### 4. `server/src/main.ts`

**问题**: 没有告知客户端分配的playerId；缺少输入接收日志

**修复**:
```diff
  if (parsed.type === 'C2S_HELLO') {
    playerId = `p${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    connections.set(ws, playerId);
    room.addPlayer(playerId);
    inputQueues.set(playerId, []);

    log('CONNECT', {
      room: room.id,
      player: playerId,
      tick: room.tick,
    });
+
+   // 发送WELCOME消息，告知客户端自己的playerId
+   ws.send(
+     JSON.stringify({
+       type: 'S2C_WELCOME',
+       playerId: playerId,
+     })
+   );
  } else if (parsed.type === 'C2S_INPUT') {
    if (!playerId) {
      // ...
      return;
    }
+
+   // 节流日志：每200ms打印一次
+   const lastLog = messageLogThrottle.get(ws) || 0;
+   const now = Date.now();
+   if (now - lastLog >= 200) {
+     log('RECV_INPUT', {
+       room: room.id,
+       player: playerId,
+       tick: room.tick,
+       seq: parsed.seq,
+       inputTick: parsed.tick,
+       keys: `${parsed.keys.up ? 'U' : ''}${parsed.keys.down ? 'D' : ''}${parsed.keys.left ? 'L' : ''}${parsed.keys.right ? 'R' : ''}`,
+     });
+     messageLogThrottle.set(ws, now);
+   }

    const queue = inputQueues.get(playerId);
    if (queue) {
      queue.push({ input: parsed, ws });
    }
  }

+ // 节流日志：每200ms打印一次
+ const messageLogThrottle = new Map<WebSocket, number>();

+ // Snapshot广播日志
+ let lastSnapshotLog = 0;
  setInterval(() => {
    const snapshot = room.getSnapshot();
    // ...
+
+   // 节流日志：每200ms打印一次
+   const now = Date.now();
+   if (now - lastSnapshotLog >= 200) {
+     if (snapshot.players.length > 0) {
+       const p = snapshot.players[0];
+       log('BROADCAST_SNAPSHOT', {
+         room: room.id,
+         tick: room.tick,
+         players: snapshot.players.length,
+         firstPlayer: `${p.id.substring(0, 8)}@(${p.x.toFixed(1)},${p.y.toFixed(1)})`,
+       });
+     }
+     lastSnapshotLog = now;
+   }
  }, SNAPSHOT_INTERVAL_MS);
```

### 5. `server/src/room.ts`

**问题**: 输入处理日志过于频繁；需要更清晰的移动前后位置对比

**修复**:
```diff
  export class Room {
+   // 节流日志：每200ms打印一次
+   private lastProcessLog = new Map<string, number>();

    processInput(playerId: string, input: C2S_INPUT): void {
      const player = this.players.get(playerId);
      if (!player) return;

-     // 丢弃过期输入（seq小于等于已处理的）
+     // 只使用seq去重，不检查tick（简化策略）
      if (input.seq <= player.lastInputSeq) {
        return;
      }

+     const oldX = player.x;
+     const oldY = player.y;
+
      player.lastInputSeq = input.seq;
      player.lastInputTick = input.tick;

      const deltaTime = 0.05;
      player.processInput(input.keys, deltaTime, this.mapConfig.width, this.mapConfig.height);

-     log('INPUT', {
+     // 节流日志：每200ms打印一次
+     const lastLog = this.lastProcessLog.get(playerId) || 0;
+     const now = Date.now();
+     if (now - lastLog >= 200) {
+       log('PROCESS_INPUT', {
          room: this.id,
          player: playerId,
          tick: this.tick,
          seq: input.seq,
-         up: input.keys.up ? 1 : 0,
-         down: input.keys.down ? 1 : 0,
-         left: input.keys.left ? 1 : 0,
-         right: input.keys.right ? 1 : 0,
+         pos: `(${oldX.toFixed(1)},${oldY.toFixed(1)})->(${player.x.toFixed(1)},${player.y.toFixed(1)})`,
        });
+       this.lastProcessLog.set(playerId, now);
+     }
    }
  }
```

### 6. `server/src/smoke.ts`

**问题**: 无法识别哪个WebSocket控制哪个玩家；移动检测阈值不合理

**修复**:
```diff
  interface TestClient {
    ws: WebSocket;
    id: string;
    snapshots: S2C_SNAPSHOT[];
    connected: boolean;
+   playerId: string | null; // 服务器分配的playerId
  }

  ws.on('message', (data: Buffer) => {
    try {
      const raw = JSON.parse(data.toString());
      
+     // 处理S2C_WELCOME消息
+     if (raw.type === 'S2C_WELCOME' && raw.playerId) {
+       client.playerId = raw.playerId;
+       console.log(`[${id}] Received welcome, playerId: ${client.playerId}`);
+       return;
+     }
+
      const message = S2C_MESSAGE_SCHEMA.parse(raw);
      // ...
    }
  });

  // 等待WELCOME消息和初始snapshot
- await new Promise((resolve) => setTimeout(resolve, 200));
+ await new Promise((resolve) => setTimeout(resolve, 500));

+ if (!client1.playerId || !client2.playerId) {
+   throw new Error('Failed to receive WELCOME messages');
+ }
+
+ console.log(`Client1 playerId: ${client1.playerId}`);
+ console.log(`Client2 playerId: ${client2.playerId}`);

  // 断言：至少一个玩家坐标发生变化（1.5s内移动距离>10px）
  const firstSnapshot1 = client1.snapshots[0];
  if (firstSnapshot1.players.length === 0) {
    throw new Error('No players in first snapshot');
  }

- const player1First = firstSnapshot1.players[0];
+ // 找到client1对应的玩家
+ const player1First = firstSnapshot1.players.find((p) => p.id === client1.playerId);
  if (!player1First) {
-   throw new Error('Player1 not found in first snapshot');
+   throw new Error(`Client1 player (${client1.playerId}) not found in first snapshot`);
  }

- const player1Last = lastSnapshot1.players.find((p) => p.id === player1First.id);
+ const player1Last = lastSnapshot1.players.find((p) => p.id === client1.playerId);
  if (!player1Last) {
-   throw new Error('Player1 not found in last snapshot');
+   throw new Error(`Client1 player (${client1.playerId}) not found in last snapshot`);
  }

  const dx = player1Last.x - player1First.x;
  const dy = player1Last.y - player1First.y;
- const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1;
+ const distance = Math.sqrt(dx * dx + dy * dy);

- if (!moved) {
-   throw new Error('No player movement detected');
+ console.log(`\n=== Movement Analysis ===`);
+ console.log(`PlayerId: ${client1.playerId}`);
+ console.log(`Initial position: (${player1First.x.toFixed(2)}, ${player1First.y.toFixed(2)})`);
+ console.log(`Final position: (${player1Last.x.toFixed(2)}, ${player1Last.y.toFixed(2)})`);
+ console.log(`Distance moved: ${distance.toFixed(2)}px`);
+
+ if (distance < 10) {
+   throw new Error(
+     `Player movement too small: ${distance.toFixed(2)}px < 10px. PlayerId: ${client1.playerId}`
+   );
  }

- console.log('✓ All assertions passed!');
- console.log(`✓ Players moved: Player1 from (${player1First.x.toFixed(1)}, ${player1First.y.toFixed(1)}) to (${player1Last.x.toFixed(1)}, ${player1Last.y.toFixed(1)})`);
- console.log(`✓ Tick range: ${ticks1[0]} -> ${ticks1[ticks1.length - 1]}`);
+ console.log('✓ All assertions passed!');
+ console.log(`✓ Tick range: ${ticks1[0]} -> ${ticks1[ticks1.length - 1]}`);
```

## 输入处理策略说明

**最终采用的规则**:
- 只使用`seq`字段去重，不检查`tick`字段
- 每个tick处理队列中的所有有效输入（seq > lastInputSeq）
- `tick`字段保留在协议中但不用于gating，仅用于日志记录

**理由**:
- 简化逻辑，避免tick不匹配导致输入被丢弃
- seq自增保证顺序，足够用于去重
- 每个tick都能处理到最新的输入

## 验证结果

```powershell
PS> npm run test:smoke
Starting smoke test...
Connecting to ws://localhost:8080
[client1] Received welcome, playerId: p1767409769691_5ofjq4y8q
[client2] Received welcome, playerId: p1767409769798_nlcte382z
Client1 connected: true
Client2 connected: true

=== Test Results ===
Client1 snapshots received: 25
Client2 snapshots received: 24

=== Movement Analysis ===
PlayerId: p1767409769691_5ofjq4y8q
Initial position: (273.77, 1669.32)
Final position: (563.77, 1669.32)
Distance moved: 290.00px
✓ All assertions passed!
✓ Tick range: 99 -> 141

✅ Smoke test PASSED
```

## 验收步骤

1. **构建验证**:
   ```powershell
   npm run build
   ```
   预期：所有包构建成功，无错误

2. **启动服务器**:
   ```powershell
   npm run dev:all
   ```
   预期：server在8080端口，client在5173端口

3. **浏览器验证**:
   - 打开两个浏览器窗口访问 `http://localhost:5173`
   - 两个窗口都应该显示"Connected"状态
   - 两个窗口的HUD都应该显示2个玩家
   - 窗口1按WASD移动，窗口2应该能看到窗口1对应的玩家连续移动

4. **Smoke Test验证**:
   ```powershell
   # 确保server在运行
   npm run test:smoke
   ```
   预期：测试通过，玩家移动距离>10px

