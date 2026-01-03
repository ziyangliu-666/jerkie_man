# Day3 规划：Loot + Extract MVP 闭环

## 目标玩法

- 地图里生成一些 item（服务端生成，客户端可见）
- 玩家按 E 拾取附近 item（一次拾取一个，服务端判定距离）
- 玩家有"战利品计数 lootCount"（MVP 先用数字，不做复杂背包）
- 地图上有一个撤离区 extractZone（矩形区域）
- 玩家进入撤离区后按 F 撤离：玩家 status 变为 EXTRACTED，不再移动/开火；HUD 显示该玩家撤离成功以及 lootCount
- 所有状态通过 S2C_SNAPSHOT 广播（MVP 允许其他玩家看到 lootCount）

## 需要修改/新增的点

### 1) 协议（shared/src/protocol.ts）

- 在 `C2S_INPUT_SCHEMA` 增加两个可选字段：
  - `interact?: boolean` (E，拾取脉冲事件)
  - `extract?: boolean` (F，撤离脉冲事件)
- 在 `PLAYER_STATE_SCHEMA` 增加：
  - `lootCount: z.number().int().min(0)` (>=0)
- 更新所有 schema/type 让 build 通过；保持向后兼容（新增字段尽量 optional 或提供默认值）

### 2) 内容配置（shared/src/content.ts）

- 在 `MAP_CONFIG` 里增加：
  - `extractZone: { x: number; y: number; w: number; h: number }`
- `loadMapConfig()` 返回默认 extractZone
- （可选）加入一个简单 seeded PRNG（比如 xorshift），用于 deterministic item 生成；如果放 shared/math.ts 更好

### 3) Server（server/src/room.ts + player.ts）

- Player 增加 `lootCount` 字段，`toState()` 带上
- Room 初始化时生成 N 个 ITEM_STATE（比如 30 个），分布在地图里；id 唯一；type 从 DEFAULT_ITEM_TYPES 里选；quantity=1
- `processInput()`：
  - 如果 `input.interact` 为 true：在 items 里找距离玩家最近且 dist <= pickupRadius（比如 28）的 item，拾取：
    - `player.lootCount += 1`（或按 rarity 加不同分，先用 +1）
    - 从 room.items 移除该 item
    - log: `PICKUP item=... pos=... loot=...`
  - 如果 `input.extract` 为 true：如果玩家在 extractZone 内：
    - `player.status = 'EXTRACTED'`
    - log: `EXTRACT player=... loot=...`
- 限制：DEAD/EXTRACTED 玩家不能移动/开火/拾取（`player.processInput` 里加 EXTRACTED 判断；开火逻辑也要挡）

### 4) Client（client/src/input.ts + main.ts + renderer.ts + hud.ts）

- InputManager：
  - 监听 keydown 'e' / 'f'，实现"脉冲事件"(edge-trigger)：
    - 提供 `consumeInteract(): boolean`
    - 提供 `consumeExtract(): boolean`
    - 每次被 consume 后自动清零，避免按住一直播
- main.ts：
  - `sendInput(seq, keys, aim, shoot, interact, extract)`（需要扩展 Network.sendInput）
  - HUD counts 增加：本地玩家 lootCount、状态（ALIVE/DEAD/EXTRACTED）
- renderer.ts：
  - 绘制 items（小方块/小圆点即可）
  - 绘制 extractZone（半透明矩形框即可）
  - 注意 camera 偏移一致（items/zone 都用 world->screen 的同一套）

### 5) Network（client/src/network.ts）

- `sendInput` 扩展参数，把 interact/extract 一起发
- Zod parse 的字段要匹配新 schema

## 验收

- `npm run dev:all`
- 打开两个窗口：
  - 窗口1 移动到 item 附近按 E：item 消失；HUD 里本地 lootCount +1；窗口2 也看到 item 消失（因为 server authoritative）
  - 移动到撤离区按 F：本地 status 变 EXTRACTED，不能再移动/开火；HUD 提示撤离成功与 lootCount
- 日志：server 输出 PICKUP / EXTRACT 结构化日志，带 room/tick/player 等上下文

## 注意

- 不要引入新框架；保持现在的 Canvas2D + ws + zod
- 先实现可玩闭环，再考虑数值/美术

## 关键概念

### 脉冲输入（edge-trigger）

一次按键只触发一次事件（E 拾取 / F 撤离），不会因为按住而每 40ms 连发。

- 例子：`consumeInteract()` 读到 true 就立刻清零
- 最小步骤：InputManager 里 keydown 设置 flag；main.ts 每次发送 input 前 consume 一次

### 公共状态 vs 私有状态

snapshot 是广播的，所有人都会收到。

- MVP 先把 `lootCount` 当公共字段没问题；以后要做"只自己看见的背包"，再拆 `S2C_SELF_STATE`

### Seeded 生成（可复现）

用 seed 生成同一批 items，调试会舒服很多。

- MVP 也可以先用 `Math.random()`，但你后面要做录像/回放/一致性，会更想要 seed

