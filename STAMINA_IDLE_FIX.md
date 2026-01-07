# 耐力条静止时不更新问题修复

## 问题描述
玩家静止不动时，耐力条不更新，即使服务器端应该每个tick都在恢复耐力。

## 问题根源
服务器端的耐力更新**只在玩家有输入时才会执行**：

1. 服务器的tick循环只处理输入队列中的输入
2. 如果玩家没有发送输入（不移动），服务器不会调用 `player.processInput()`
3. 而耐力更新逻辑在 `processInput()` 方法中
4. 因此玩家静止时，服务器端不会更新耐力（包括恢复）

## 解决方案

### 1. 添加独立的耐力更新方法 (`server/src/player.ts`)
```typescript
updateStamina(deltaTime: number, isMoving: boolean, wantsSprint: boolean): void {
  // 更新冲刺状态
  this.isSprinting = canSprint(this.stamina, wantsSprint) && isMoving;
  
  // 更新耐力
  this.stamina = calculateStaminaChange(
    this.stamina,
    this.maxStamina,
    this.isSprinting,
    isMoving,
    deltaTime
  );
  
  // 如果耐力耗尽，停止冲刺
  if (this.stamina <= 0) {
    this.isSprinting = false;
  }
}
```

### 2. 重构 `processInput` 方法使用新方法
将原来的耐力更新代码替换为调用 `updateStamina()`，避免代码重复。

### 3. 在tick循环中为所有玩家更新耐力 (`server/src/main.ts`)
```typescript
// 记录本tick有输入的玩家（避免重复更新耐力）
const playersWithInput = new Set<string>();

// 处理输入队列...
for (const [playerId, queue] of inputQueues.entries()) {
  if (queue.length === 0) continue;
  playersWithInput.add(playerId); // 标记有输入
  // ...
}

// 为没有输入的玩家更新耐力
for (const [playerId, player] of room.players.entries()) {
  if (player.status === 'ALIVE' && !playersWithInput.has(playerId)) {
    // 玩家本tick没有输入，手动更新耐力（不移动，不冲刺）
    player.updateStamina(0.05, false, false); // deltaTime=0.05秒（20Hz）
  }
}
```

## 修改文件
- `server/src/main.ts` - 添加耐力更新逻辑到tick循环
- `server/src/player.ts` - 添加 `updateStamina()` 方法并重构 `processInput()`

## 测试验证
1. 启动服务器和客户端
2. 进入游戏后冲刺消耗耐力
3. 停止移动，观察耐力条是否持续恢复
4. 确认耐力条每tick都在更新（即使玩家不动）
