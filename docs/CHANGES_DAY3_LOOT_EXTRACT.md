# Day3 Loot + Extract MVP - 变更摘要

## 概述

实现 Day3 Loot + Extract MVP 闭环，包括物品生成/拾取、简单背包计数、撤离点和结算 HUD。

## 实现的功能

### 1. 协议扩展（shared/src/protocol.ts）

- ✅ `C2S_INPUT_SCHEMA` 增加两个可选字段：
  - `interact?: boolean` - 拾取脉冲事件（E键）
  - `extract?: boolean` - 撤离脉冲事件（F键）
- ✅ `PLAYER_STATE_SCHEMA` 增加：
  - `lootCount: z.number().int().min(0).default(0)` - 战利品计数

### 2. 内容配置（shared/src/content.ts）

- ✅ `MAP_CONFIG_SCHEMA` 增加 `extractZone` 字段
- ✅ `DEFAULT_MAP_CONFIG` 设置默认撤离区（地图右下角，200x200区域）
- ✅ `loadMapConfig()` 返回包含 extractZone 的配置

### 3. Server 实现

**Player 类（server/src/player.ts）**：
- ✅ 增加 `lootCount: number` 字段（初始化为 0）
- ✅ `toState()` 方法包含 `lootCount`
- ✅ `processInput()` 增加 EXTRACTED 状态判断（EXTRACTED 玩家不能移动）

**Room 类（server/src/room.ts）**：
- ✅ 构造函数中生成 30 个物品（随机分布，避免重叠）
- ✅ `processInput()` 扩展：
  - 处理 `interact`：找最近物品（距离 <= 28px），拾取后 `lootCount += 1`，移除物品
  - 处理 `extract`：检查玩家是否在撤离区内，如果在则设置 `status = 'EXTRACTED'`
- ✅ 开火逻辑增加 EXTRACTED 状态检查（EXTRACTED 玩家不能开火）
- ✅ 结构化日志：`PICKUP` 和 `EXTRACT` 事件

### 4. Client 实现

**InputManager（client/src/input.ts）**：
- ✅ 增加 `interactFlag` 和 `extractFlag` 脉冲事件标志
- ✅ 监听 keydown 'e' / 'f'，设置对应标志
- ✅ 提供 `consumeInteract()` 和 `consumeExtract()` 方法（edge-trigger：返回当前值并清零）
- ✅ 窗口失去焦点时清除所有标志

**Network（client/src/network.ts）**：
- ✅ `sendInput()` 方法扩展参数：`interact` 和 `extract`

**main.ts（client/src/main.ts）**：
- ✅ 获取地图配置（用于提取 extractZone）
- ✅ 渲染循环中消费脉冲事件（`consumeInteract()` / `consumeExtract()`）
- ✅ 输入发送逻辑包含 interact/extract 变化检测
- ✅ `renderer.render()` 调用传入 `items` 和 `extractZone`

**Renderer（client/src/renderer.ts）**：
- ✅ `drawItem()` 方法：绘制物品（绿色小方块）
- ✅ `drawExtractZone()` 方法：绘制撤离区（半透明绿色矩形框）
- ✅ `render()` 方法扩展：接收 `items` 和 `extractZone` 参数

**HUD（client/src/hud.ts）**：
- ✅ Players 表格增加 `Loot` 列
- ✅ Selected Entity 显示 `Loot Count`

## 验证结果

### ✅ 构建测试
```powershell
npm run build
```
**结果**: 通过

### ✅ Smoke Test
```powershell
npm run test:smoke
```
**结果**: PASSED
- 两个客户端成功连接
- 玩家移动正常（310px）
- Tick递增正常

### ⏳ 手动验证（需要手动测试）

**拾取测试**：
- 移动到 item 附近按 E
- item 消失
- HUD 里本地 lootCount +1
- 窗口2 也看到 item 消失（server authoritative）

**撤离测试**：
- 移动到撤离区（extractZone）
- 按 F
- 本地 status 变 EXTRACTED
- 不能再移动/开火
- HUD 显示 lootCount

**观察测试**：
- 窗口2 能看到窗口1 玩家的 lootCount
- 窗口2 能看到窗口1 玩家 status 变为 EXTRACTED

**Server 日志**：
- 输出 `PICKUP` 结构化日志
- 输出 `EXTRACT` 结构化日志

## 技术细节

### 脉冲输入（edge-trigger）

- **实现方式**：InputManager 里 keydown 设置 flag，main.ts 每次发送 input 前 consume 一次，consume 后自动清零
- **优势**：一次按键只触发一次事件，不会因为按住而每 40ms 连发

### 物品生成策略

- **数量**：30 个物品
- **分布**：随机分布，避免重叠（最小距离 32px）
- **类型**：从 `DEFAULT_ITEM_TYPES` 随机选择
- **后续**：可扩展为 seeded 生成（预留接口）

### 拾取逻辑

- **距离判定**：玩家到物品距离 <= 28px
- **优先级**：找最近物品（如果多个物品在范围内）
- **战利品计数**：每个物品 +1（MVP 简化，后续可按 rarity 加不同分）

### 撤离逻辑

- **区域判定**：矩形碰撞检测（`isInExtractZone()`）
- **状态变更**：`status = 'EXTRACTED'`
- **限制**：EXTRACTED 玩家不能移动/开火/拾取

### 矩形碰撞检测

```typescript
function isInExtractZone(x: number, y: number, zone: { x: number; y: number; w: number; h: number }): boolean {
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
}
```

## 代码风格

- 所有改动都有清晰注释，说明"为什么"
- 保持现有 TypeScript 模式
- 结构化日志格式一致
- 错误处理完善

## 总结

Day3 Loot + Extract MVP 闭环完成：
- ✅ 协议扩展（interact/extract/lootCount）
- ✅ 内容配置（extractZone）
- ✅ Server 实现（物品生成、拾取、撤离）
- ✅ Client 实现（脉冲输入、渲染、HUD）
- ✅ 构建和 smoke test 通过

**下一步**：
- 手动验证功能完整性
- 后续可扩展：seeded 生成、按 rarity 加不同分、更复杂的背包系统

所有代码修改已完成并验证通过。可以开始手动测试验证功能完整性。

