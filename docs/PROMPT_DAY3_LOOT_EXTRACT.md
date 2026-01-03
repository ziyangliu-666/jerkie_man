# Day3 Prompt：Loot + Extract MVP 闭环

## 任务描述

你在一个 npm workspace 的 TS 全栈联机 2D 游戏项目里实现 Day3：Loot + Extract MVP 闭环。

**要求**：
- 保持 server authoritative
- 所有协议用 `shared/src/protocol.ts` 的 Zod 校验
- 保持现有结构化日志风格
- 改动尽量小但可玩

## 目标玩法

- 地图里生成一些 item（服务端生成，客户端可见）
- 玩家按 E 拾取附近 item（一次拾取一个，服务端判定距离）
- 玩家有"战利品计数 lootCount"（MVP 先用数字，不做复杂背包）
- 地图上有一个撤离区 extractZone（矩形区域）
- 玩家进入撤离区后按 F 撤离：玩家 status 变为 EXTRACTED，不再移动/开火；HUD 显示该玩家撤离成功以及 lootCount
- 所有状态通过 S2C_SNAPSHOT 广播（MVP 允许其他玩家看到 lootCount；如果容易，就额外做"只给自己看的私有字段"，但不是必须）

## 需要修改/新增的点

### 1) 协议（shared/src/protocol.ts）

- 在 `C2S_INPUT_SCHEMA` 增加两个可选字段：
  - `interact?: z.boolean().optional()` (E，拾取脉冲事件)
  - `extract?: z.boolean().optional()` (F，撤离脉冲事件)
- 在 `PLAYER_STATE_SCHEMA` 增加：
  - `lootCount: z.number().int().min(0).default(0)` (>=0，默认0)
- 更新所有 schema/type 让 build 通过；保持向后兼容（新增字段尽量 optional 或提供默认值）

### 2) 内容配置（shared/src/content.ts）

- 在 `MAP_CONFIG` 里增加：
  - `extractZone: { x: number; y: number; w: number; h: number }`
- `loadMapConfig()` 返回默认 extractZone（例如：地图右下角，200x200 区域）
- （可选）加入一个简单 seeded PRNG（比如 xorshift），用于 deterministic item 生成；如果放 `shared/src/math.ts` 更好
- MVP 也可以先用 `Math.random()`，但建议预留 seed 接口

### 3) Server（server/src/room.ts + player.ts）

**Player 类**：
- 增加 `lootCount: number` 字段（初始化为 0）
- `toState()` 方法带上 `lootCount`

**Room 类**：
- 初始化时生成 N 个 ITEM_STATE（比如 30 个），分布在地图里
  - id 唯一：`item_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
  - type 从 `DEFAULT_ITEM_TYPES` 里选（如果还没有，先创建一个简单的类型列表）
  - quantity=1
  - 位置随机分布（避免重叠，简单策略：随机 x/y，如果距离其他 item < 32 则重新生成）
- `processInput()` 扩展：
  - 如果 `input.interact` 为 true 且玩家状态为 ALIVE：
    - 在 items 里找距离玩家最近且 dist <= pickupRadius（比如 28）的 item
    - 如果找到：拾取
      - `player.lootCount += 1`（或按 rarity 加不同分，先用 +1）
      - 从 `room.items` 移除该 item
      - log: `PICKUP item=... pos=... loot=...`
  - 如果 `input.extract` 为 true 且玩家状态为 ALIVE：
    - 检查玩家是否在 extractZone 内（矩形碰撞检测）
    - 如果在区域内：
      - `player.status = 'EXTRACTED'`
      - log: `EXTRACT player=... loot=... tick=...`
- 限制：DEAD/EXTRACTED 玩家不能移动/开火/拾取
  - `player.processInput()` 里加 EXTRACTED 判断（已有 DEAD 判断）
  - 开火逻辑也要挡（`room.processInput()` 里检查 status）

### 4) Client（client/src/input.ts + main.ts + renderer.ts + hud.ts）

**InputManager**：
- 增加两个脉冲事件标志：
  - `private interactFlag = false`
  - `private extractFlag = false`
- 监听 keydown 'e' / 'f'：
  - 'e' 按下时：`interactFlag = true`
  - 'f' 按下时：`extractFlag = true`
- 提供 consume 方法（edge-trigger）：
  - `consumeInteract(): boolean` - 返回当前 flag 并清零
  - `consumeExtract(): boolean` - 返回当前 flag 并清零
- 窗口失去焦点时清除所有标志

**main.ts**：
- 扩展 `network.sendInput()` 调用：
  - `sendInput(seq, keys, aim, shoot, interact, extract)`
- 在渲染循环中：
  - 获取 `interact` 和 `extract` 状态（通过 consume 方法）
  - 如果 interact 或 extract 为 true，触发输入发送（即使 keys/aim/shoot 没变化）
- HUD 更新：
  - 显示本地玩家 `lootCount`
  - 显示玩家状态（ALIVE/DEAD/EXTRACTED）
  - Selected Entity 显示 lootCount 和 status

**renderer.ts**：
- 增加 `drawItem(item: ITEM_STATE)` 方法：
  - 小方块或小圆点（颜色可区分 type，先用统一颜色）
  - 考虑 camera 偏移（使用 world->screen 转换）
- 增加 `drawExtractZone(zone: { x: number; y: number; w: number; h: number })` 方法：
  - 半透明矩形框（例如：rgba(0, 255, 0, 0.2)）
  - 边框线（例如：绿色，2px）
  - 考虑 camera 偏移
- `render()` 方法扩展：
  - 接收 `items: ITEM_STATE[]` 和 `extractZone` 参数
  - 绘制所有 items
  - 绘制 extractZone

**hud.ts**：
- HUD 数据扩展：
  - 显示本地玩家 `lootCount`
  - 显示玩家状态（ALIVE/DEAD/EXTRACTED）
  - Selected Entity 显示 lootCount 和 status

### 5) Network（client/src/network.ts）

- `sendInput` 方法扩展参数：
  - `sendInput(seq, keys, aim, shoot, interact, extract)`
- Zod parse 的字段要匹配新 schema（interact 和 extract 是可选字段）

## 验收

### 必须通过

1. **构建测试**：
   ```bash
   npm run build
   ```
   必须通过，无 TypeScript 错误

2. **Smoke Test**：
   ```bash
   npm run test:smoke
   ```
   必须通过（如果 smoke test 不覆盖新功能，至少不能因为新代码而失败）

3. **手动验证**：
   - `npm run dev:all`
   - 打开两个浏览器窗口（`http://localhost:5173`）
   - **窗口1 拾取测试**：
     - 移动到 item 附近按 E
     - item 消失
     - HUD 里本地 lootCount +1
     - 窗口2 也看到 item 消失（因为 server authoritative）
   - **窗口1 撤离测试**：
     - 移动到撤离区（extractZone）
     - 按 F
     - 本地 status 变 EXTRACTED
     - 不能再移动/开火
     - HUD 提示撤离成功与 lootCount
   - **窗口2 观察**：
     - 能看到窗口1 玩家的 lootCount
     - 能看到窗口1 玩家 status 变为 EXTRACTED

4. **Server 日志**：
   - 输出 `PICKUP` 结构化日志，带 room/tick/player/item 等上下文
   - 输出 `EXTRACT` 结构化日志，带 room/tick/player/loot 等上下文

## 注意

- 不要引入新框架；保持现在的 Canvas2D + ws + zod
- 先实现可玩闭环，再考虑数值/美术
- 保持代码风格一致（TypeScript、结构化日志、错误处理）
- 所有改动必须有清晰注释，说明"为什么"

## 关键概念

### 脉冲输入（edge-trigger）

一次按键只触发一次事件（E 拾取 / F 撤离），不会因为按住而每 40ms 连发。

**实现方式**：
- InputManager 里 keydown 设置 flag
- main.ts 每次发送 input 前 consume 一次
- consume 后自动清零

**例子**：
```typescript
// InputManager
private interactFlag = false;
keydown('e') => interactFlag = true;
consumeInteract() => { const v = interactFlag; interactFlag = false; return v; }
```

### 公共状态 vs 私有状态

snapshot 是广播的，所有人都会收到。

- MVP 先把 `lootCount` 当公共字段没问题
- 以后要做"只自己看见的背包"，再拆 `S2C_SELF_STATE`

### Seeded 生成（可复现）

用 seed 生成同一批 items，调试会舒服很多。

- MVP 也可以先用 `Math.random()`
- 但建议预留 seed 接口（例如：`generateItems(seed: number)`）
- 后续要做录像/回放/一致性，会更想要 seed

### 矩形碰撞检测

检查玩家是否在 extractZone 内：

```typescript
function isInZone(x: number, y: number, zone: { x: number; y: number; w: number; h: number }): boolean {
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
}
```

## 交付要求

1. **代码修改**：所有相关文件已修改，build 通过
2. **功能验证**：手动测试通过，两个窗口能正常交互
3. **日志验证**：Server 输出结构化日志
4. **文档更新**（可选）：如果 README 需要更新，同步更新

## 开始执行

请按上述要求实现 Day3 Loot + Extract MVP 闭环。

