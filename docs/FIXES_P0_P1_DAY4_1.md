# P0/P1 修复总结（Day4-1 后续）

## 修复时间
2026-01-03

## 修复内容

### P0-1：RoomInfo 里 mapConfig 类型手写，存在"漂移风险"

**问题描述**：
- 位置：`client/src/network.ts`
- 原逻辑：`RoomInfo.mapConfig` 手写了 `{width,height,seed,extractZone...}` 结构
- 问题：如果 `shared` 的 `MAP_CONFIG` 未来加字段/改字段，这里会一个编译过、一个运行错
- 影响：类型不一致，维护困难

**修复方案**：
- `client/src/network.ts` 直接 `import type { MAP_CONFIG } from '@jerkie-man/shared'`
- `RoomInfo.mapConfig?: MAP_CONFIG`，不再手写结构

**代码变更**：
```typescript
// 修复前
export interface RoomInfo {
  seed?: number;
  mapConfig?: { width: number; height: number; seed: number; extractZone: { x: number; y: number; w: number; h: number } };
}

// 修复后
import type { MAP_CONFIG } from '@jerkie-man/shared';
export interface RoomInfo {
  seed?: number;
  mapConfig?: MAP_CONFIG;
}
```

**验证**：
- ✅ `npm run build` 通过
- ✅ 类型自动同步，避免漂移

---

### P0-2：断线时 client 还在用旧 snapshot 渲染世界

**问题描述**：
- 位置：`client/src/network.ts`、`client/src/main.ts`
- 原逻辑：Network 断线后 HUD 显示 disconnected，但画面可能还在显示最后一帧玩家/物品
- 问题：会让后续做 "Raid 状态 / 结算 / 重连回大厅" 时很别扭
- 影响：断线后仍显示旧世界，用户体验差

**修复方案**：
- `Network.onclose` 时调用 `snapshotBuffer.clear()`
- `main.ts` 的 `onDisconnect` 回调添加 "World cleared" 事件

**代码变更**：

`client/src/network.ts`：
```typescript
this.ws.onclose = () => {
  this.isConnected = false;
  // P0-2 修复: 断线时清理 snapshot buffer，避免显示旧世界
  this.snapshotBuffer.clear();
  // ...
};
```

`client/src/main.ts`：
```typescript
onDisconnect: () => {
  console.log('Disconnected from server');
  hud.addEvent('Disconnected from server');
  hud.addEvent('World cleared'); // P0-2 修复: 提示世界已清空
  // ...
}
```

**验证**：
- ✅ 断线后画面清空（不再显示旧玩家/物品）
- ✅ HUD event 显示 "World cleared"

---

### P0-3：WELCOME 里 seed/mapConfig 是 optional，但 Day4-2 需要时应该报错

**问题描述**：
- 位置：`client/src/main.ts`
- 原逻辑：如果 server 未下发 `mapConfig`，fallback 到本地配置并警告
- 问题：Day4-2 要"seed 生成物品/障碍物"，缺失会导致世界不同步
- 影响：开发态应该直接报错，而不是 fallback

**修复方案**：
- 从 Day4-2 起，`seed/mapConfig` 缺失时直接报错，不再 fallback
- HUD event 显示 `ERROR: Missing world config: mapConfig, seed`
- 不保存配置，等待重连或手动处理

**代码变更**：
```typescript
// P0-3 修复: Day4-2 起，seed/mapConfig 缺失时直接报错，不再 fallback
if (!roomInfo?.mapConfig || roomInfo.seed === undefined) {
  const missing = [];
  if (!roomInfo?.mapConfig) missing.push('mapConfig');
  if (roomInfo?.seed === undefined) missing.push('seed');
  hud.addEvent(`ERROR: Missing world config: ${missing.join(', ')}`);
  hud.addEvent('Cannot proceed without server world config');
  console.error('Missing world config from server:', { mapConfig: !!roomInfo?.mapConfig, seed: roomInfo?.seed });
  return; // 不保存，等待重连或手动处理
}
```

**验证**：
- ✅ 如果 server 未下发配置，HUD 显示错误，不 fallback
- ✅ 未来可以进入"等待世界配置"状态

---

### P1-1：seed 目前是随机生成，缺"可复现入口"

**问题描述**：
- 位置：`server/src/room.ts`、`server/src/main.ts`、`server/src/smoke.ts`
- 原逻辑：seed 随机生成，smoke test 只断言 seed 存在
- 问题：调试某个地图/某个 bug 时，没办法稳定复现同一个世界
- 影响：测试不稳定，调试困难

**修复方案**：
- `Room` 构造函数支持 `seed` 参数（优先级：参数 > 环境变量 > 随机）
- `server/src/main.ts` 支持 `process.env.SEED`
- `smoke test` 使用固定 `SEED=12345`

**代码变更**：

`server/src/room.ts`：
```typescript
constructor(id: string, seed?: number) {
  // P1-1 修复: 支持 seed 可注入（优先级：参数 > 环境变量 > 随机）
  if (seed !== undefined) {
    this.seed = seed;
  } else if (process.env.SEED !== undefined) {
    const envSeed = parseInt(process.env.SEED, 10);
    if (isNaN(envSeed)) {
      throw new Error(`Invalid SEED environment variable: ${process.env.SEED}`);
    }
    this.seed = envSeed;
  } else {
    this.seed = Math.floor(Math.random() * 2**31);
  }
  // ...
}
```

`server/src/main.ts`：
```typescript
// P1-1 修复: 支持通过环境变量 SEED 注入 seed
const room = new Room('local', process.env.SEED ? parseInt(process.env.SEED, 10) : undefined);
```

`server/src/smoke.ts`：
```typescript
// P1-1 修复: smoke test 使用固定 SEED，保证生成一致
const TEST_SEED = 12345;
// ...
env: { ...process.env, PORT: PORT.toString(), SEED: TEST_SEED.toString() },
```

**验证**：
- ✅ `SEED=12345 npm run dev:server` 使用固定 seed
- ✅ `npm run test:smoke` 使用固定 seed，保证生成一致

---

### P1-2：HUD 的 connection.status 只有 connected/disconnected，没有 reconnecting

**问题描述**：
- 位置：`client/src/network.ts`、`client/src/main.ts`、`client/src/hud.ts`
- 原逻辑：Network 有指数退避重连，但 HUD 不表达出来
- 问题：排障时不直观，用户不知道是否在重连
- 影响：调试困难，用户体验差

**修复方案**：
- `Network` 暴露 `getReconnectState()` 和更新 `getConnectionState()`
- `main.ts` 支持 `reconnecting` 状态
- `HUD` 显示重连信息（attempt 次数、下次重连倒计时）

**代码变更**：

`client/src/network.ts`：
```typescript
// P1-2 修复: 暴露重连状态，供 HUD 显示
public getReconnectState(): { attempts: number; nextReconnectInMs: number | null } {
  return {
    attempts: this.reconnectAttempts,
    nextReconnectInMs: this.reconnectTimer !== null ? this.reconnectDelay : null,
  };
}

getConnectionState(): {
  connected: boolean;
  reconnecting: boolean; // P1-2 修复
  reconnectAttempts: number; // P1-2 修复
  nextReconnectInMs: number | null; // P1-2 修复
  lastServerTick: number;
} {
  const reconnectState = this.getReconnectState();
  return {
    connected: this.isConnected,
    reconnecting: !this.isConnected && this.shouldReconnect && reconnectState.attempts > 0,
    reconnectAttempts: reconnectState.attempts,
    nextReconnectInMs: reconnectState.nextReconnectInMs,
    lastServerTick: this.lastServerTick,
  };
}
```

`client/src/main.ts`：
```typescript
// P1-2 修复: 支持 reconnecting 状态
let connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
if (connState.connected) {
  connectionStatus = 'connected';
} else if (connState.reconnecting) {
  connectionStatus = 'reconnecting';
} else {
  connectionStatus = 'disconnected';
}
```

`client/src/hud.ts`：
```typescript
// P1-2 修复: 显示重连信息
let statusDisplay: string = data.connection.status;
if (data.connection.status === 'reconnecting') {
  const attempts = data.connection.reconnectAttempts ?? 0;
  const nextIn = data.connection.nextReconnectInMs;
  statusDisplay = `reconnecting (attempt ${attempts}${nextIn !== null ? `, next in ${nextIn}ms` : ''})`;
}
```

**验证**：
- ✅ 断线后 HUD 显示 "reconnecting (attempt 1, next in 1000ms)"
- ✅ 重连成功/失败后状态正确更新

---

## 修改文件清单

1. **`client/src/network.ts`**
   - P0-1：使用 `MAP_CONFIG` 类型，避免类型漂移
   - P0-2：断线时清理 `snapshotBuffer`
   - P1-2：暴露重连状态（`getReconnectState`、`getConnectionState`）

2. **`client/src/main.ts`**
   - P0-2：`onDisconnect` 添加 "World cleared" 事件
   - P0-3：`onWelcome` 缺失配置时直接报错，不再 fallback
   - P1-2：支持 `reconnecting` 状态

3. **`client/src/hud.ts`**
   - P1-2：更新 `HUDData.connection` 接口，支持重连信息
   - P1-2：显示重连信息（attempt 次数、倒计时）

4. **`server/src/room.ts`**
   - P1-1：支持 `seed` 参数注入（参数 > 环境变量 > 随机）

5. **`server/src/main.ts`**
   - P1-1：支持 `process.env.SEED` 环境变量

6. **`server/src/smoke.ts`**
   - P1-1：使用固定 `SEED=12345`，保证生成一致

---

## 测试结果

### 构建验证
```powershell
npm run build
```
✅ 所有包构建成功

### Smoke Test 验证
```powershell
npm run test:smoke
```
✅ 测试通过，使用固定 seed（12345）

### 功能验证（手动）
- ✅ 断线后画面清空（不再显示旧玩家/物品）
- ✅ HUD 显示 "reconnecting (attempt X, next in Yms)"
- ✅ `SEED=12345 npm run dev:server` 使用固定 seed
- ✅ 如果 server 未下发配置，HUD 显示错误，不 fallback

---

## 下一步建议

1. **基于 seed 生成物品/障碍物**：使用 `room.seed` 作为 RNG seed，确保 client/server 生成一致
2. **地图边界/碰撞**：使用 `serverMapConfig.width/height` 作为世界边界
3. **动态地图生成**：基于 seed 生成随机地图布局（障碍物、房间等）

---

## 相关文档

- `docs/CHANGES_DAY4_1_MAPCONFIG.md` - Day4-1 实现记录
- `docs/FIXES_P1_RELIABILITY.md` - P1 可靠性修复



