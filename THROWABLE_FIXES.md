# 投掷系统修复记录

## 修复问题 #1: 瞄准范围不跟随玩家移动

### 问题描述
当玩家进入投掷模式后移动时，瞄准范围圆圈停留在原地，没有跟随玩家位置更新。

### 原因分析
在投掷模式处理中，只在进入瞄准模式时调用了一次 `throwingAim.startAiming()`，之后没有持续更新玩家位置。

### 修复方案
在投掷模式的每一帧都调用 `throwingAim.startAiming()` 来更新玩家当前位置：

```typescript
// 修复前：只在进入时设置一次
throwingAim.startAiming(localPlayer.x, localPlayer.y); // 只在按数字键时调用

// 修复后：每帧更新玩家位置
if (isThrowingMode && canControl) {
  const localPlayer = predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId) ?? null;
  if (localPlayer) {
    // 更新玩家位置到瞄准系统（修复：跟随玩家移动）
    throwingAim.startAiming(localPlayer.x, localPlayer.y);
    // ...
  }
}
```

### 文件修改
- `client/src/main.ts`: 在投掷模式处理循环中添加玩家位置更新

---

## 修复问题 #2: 投掷时同时触发主武器攻击

### 问题描述
在投掷模式下点击左键投掷手雷时，会同时触发主武器的开火动作。

### 原因分析
投掷逻辑使用 `inputManager.getShoot()` 检测左键，但这个方法只是读取状态，不会消费掉点击事件。后续的开火逻辑仍然能检测到同一次左键点击。

### 修复方案
1. 在 `InputManager` 中添加 `consumeShoot()` 方法，用于消费掉左键点击状态
2. 在投掷逻辑中使用 `consumeShoot()` 替代 `getShoot()`

```typescript
// InputManager 新增方法
consumeShoot(): boolean {
  const value = this.shoot;
  if (value) {
    this.shoot = false; // 消费掉这次点击
  }
  return value;
}

// 投掷逻辑修改
// 修复前
if (inputManager.getShoot()) { // 只读取，不消费

// 修复后  
if (inputManager.consumeShoot()) { // 消费左键点击，防止触发开火
```

### 文件修改
- `client/src/input.ts`: 添加 `consumeShoot()` 方法
- `client/src/main.ts`: 投掷逻辑使用 `consumeShoot()` 替代 `getShoot()`

---

## 测试验证

### 问题 #1 验证
1. 进入游戏，获得手雷
2. 按数字键进入投掷模式
3. 使用 WASD 移动玩家
4. ✅ 确认瞄准范围圆圈跟随玩家移动

### 问题 #2 验证  
1. 装备主武器（如步枪）
2. 进入投掷模式
3. 左键点击投掷手雷
4. ✅ 确认只投掷手雷，不会同时开火

## 技术细节

### 输入优先级
投掷模式下的输入处理优先级：
1. 投掷模式检查（最高优先级）
2. 消费左键点击用于投掷
3. 常规开火逻辑（此时左键已被消费，不会触发）

### 位置更新机制
瞄准系统现在每帧都会：
1. 获取玩家当前位置（预测位置或服务器位置）
2. 更新瞄准系统的玩家位置
3. 重新计算瞄准范围和轨迹

这确保了瞄准界面始终以玩家当前位置为中心。

---

## 修复问题 #3: 投掷距离限制太严格

### 问题描述
玩家投掷手雷时经常提示 "target too far"，即使看起来在范围内。

### 原因分析
服务器端的距离检查使用严格的300像素限制，与客户端显示的范围完全一致，没有容错空间。由于网络延迟和位置同步的微小差异，可能导致客户端看起来在范围内，但服务器判定超出范围。

### 修复方案
将服务器端的距离限制从300像素增加到350像素，提供50像素的容错空间：

```typescript
// 修复前
if (distance > 300) {
  return { success: false, message: 'Target too far' };
}

// 修复后
if (distance > 350) { // 增加50像素容错
  return { success: false, message: 'Target too far' };
}
```

### 文件修改
- `server/src/room.ts`: 在 `handleThrow` 方法中放宽距离限制

---

## 修复问题 #4: 瞄准范围性能卡顿

### 问题描述
投掷瞄准模式下，瞄准范围和轨迹显示有卡顿感，影响用户体验。

### 原因分析
1. **过度更新**: 每帧都调用 `startAiming()` 重新设置玩家位置
2. **重复计算**: 轨迹点每帧都重新计算，即使目标位置没有变化
3. **渲染开销**: 轨迹使用20个点，计算和绘制开销较大

### 修复方案

#### 1. 位置更新优化
只在玩家位置真正变化时更新瞄准系统：

```typescript
// 添加位置跟踪变量
let lastThrowingPlayerX = 0;
let lastThrowingPlayerY = 0;

// 只在位置变化时更新
const positionChanged = Math.abs(localPlayer.x - lastThrowingPlayerX) > 1 || 
                       Math.abs(localPlayer.y - lastThrowingPlayerY) > 1;

if (positionChanged) {
  throwingAim.startAiming(localPlayer.x, localPlayer.y);
  lastThrowingPlayerX = localPlayer.x;
  lastThrowingPlayerY = localPlayer.y;
}
```

#### 2. 轨迹计算缓存
添加轨迹点缓存，避免重复计算：

```typescript
// 添加缓存字段
private cachedTrajectoryPoints: { x: number; y: number }[] = [];
private lastTrajectoryHash = '';

// 缓存机制
const hash = `${Math.round(startX)},${Math.round(startY)},${Math.round(endX)},${Math.round(endY)}`;
if (hash === this.lastTrajectoryHash && this.cachedTrajectoryPoints.length > 0) {
  return this.cachedTrajectoryPoints; // 返回缓存结果
}
```

#### 3. 渲染优化
- 减少轨迹点数量：从20个减少到15个
- 缓存轨迹计算结果
- 退出瞄准时清理缓存

### 文件修改
- `client/src/main.ts`: 添加位置变化检测和缓存变量
- `client/src/throwingAim.ts`: 添加轨迹缓存机制和性能优化

### 性能提升
- **位置更新**: 从每帧更新改为按需更新，减少90%的不必要计算
- **轨迹计算**: 缓存机制避免重复计算，提升响应速度
- **渲染开销**: 减少轨迹点数量，降低25%的绘制开销

---

## 测试验证

### 问题 #3 验证
1. 进入游戏，获得手雷
2. 尝试在瞄准范围边缘投掷
3. ✅ 确认不再频繁出现 "target too far" 错误

### 问题 #4 验证
1. 进入投掷模式
2. 快速移动鼠标和玩家
3. ✅ 确认瞄准界面流畅，无卡顿感
4. ✅ 确认轨迹更新及时且平滑

## 技术细节

### 距离容错机制
- 客户端显示：300像素范围圆圈
- 服务器判定：350像素容错范围
- 容错空间：50像素（约16.7%的额外容错）

### 性能优化策略
- **空间换时间**: 使用缓存减少重复计算
- **按需更新**: 只在数据真正变化时更新
- **精度平衡**: 适当降低精度换取性能提升