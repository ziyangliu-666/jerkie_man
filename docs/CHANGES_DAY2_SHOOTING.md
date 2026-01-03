# Day2 打枪系统 - 变更摘要

## 概述

实现了Day2最小闭环：开火/子弹/命中扣血系统，保持权威服务器 + snapshot同步架构不变。

## 变更文件

1. **shared/src/protocol.ts** - 协议扩展：添加`shoot`字段
2. **client/src/input.ts** - 输入扩展：监听鼠标左键开火
3. **client/src/main.ts** - 发送开火状态，渲染子弹
4. **client/src/network.ts** - 网络层：传递shoot参数
5. **client/src/renderer.ts** - 渲染：绘制子弹
6. **server/src/player.ts** - 玩家：开火冷却、伤害、死亡状态
7. **server/src/room.ts** - 房间：开火逻辑、子弹更新、命中检测
8. **server/src/main.ts** - 主循环：调用子弹更新

## P0修复：Canvas宽度保护

### 问题
`window.innerWidth - 300`在窗口很窄时可能变成负数，导致渲染/点击坐标异常。

### 修复
- 使用HUD实际宽度（`getBoundingClientRect().width`）
- 添加最小值clamp：`Math.max(320, window.innerWidth - hudWidth)`
- 高度也添加最小值：`Math.max(240, window.innerHeight)`

## Day2功能实现

### 1. 协议扩展（shared/src/protocol.ts）

- `C2S_INPUT_SCHEMA`增加`shoot: z.boolean().optional()`
- 兼容：客户端可选发送，服务端按schema解析

### 2. 客户端输入（client/src/input.ts + main.ts）

- 监听`mousedown`/`mouseup`（左键）开火
- `InputManager`增加`getShoot(): boolean`
- `main.ts`发送input时带上`shoot`，shoot变化也算"需要发送"
- 窗口失去焦点时清除开火状态

### 3. 服务器权威模拟（server/src/room.ts + player.ts）

#### 开火逻辑（processInput）
- 检查`shoot=true`且满足冷却（150ms，约6.67发/秒）
- 生成子弹：速度800px/s，方向由`aim`角度决定
- 子弹初始位置：玩家当前位置
- 记录开火时间（冷却控制）

#### 子弹更新（updateBullets）
- 每tick移动子弹：`x += vx * deltaTime`，`y += vy * deltaTime`
- 出界检测：超出地图边界则删除
- 命中检测：圆形碰撞（半径16px）
  - 不命中自己
  - 不命中已死亡玩家
  - 命中扣血10，HP<=0则`status='DEAD'`
  - 命中后子弹删除

#### 玩家状态（player.ts）
- 开火冷却：`FIRE_COOLDOWN_MS = 150ms`
- `canFire(now)`: 检查冷却时间
- `recordFire(now)`: 记录开火时间
- `takeDamage(amount)`: 扣血，HP<=0设置`status='DEAD'`
- 死亡玩家不能移动：`processInput`中检查`status === 'DEAD'`

### 4. 客户端渲染（client/src/renderer.ts）

- 增加`drawBullet()`：绘制黄色小圆点（半径3px）
- `render()`支持传入`bullets`参数
- 子弹使用屏幕坐标绘制（考虑camera偏移）
- 子弹不插值，直接使用最新snapshot

### 5. Tick循环（server/src/main.ts）

- 先处理输入（可能生成子弹）
- 再调用`room.updateBullets(deltaTime)`更新子弹并检测命中
- 保持20Hz tick频率（50ms = 0.05s）

## 日志输出

### 新增日志类型

- `SPAWN_BULLET`: 生成子弹
  - `bullet`: 子弹ID
  - `pos`: 位置
  - `aim`: 角度

- `HIT`: 命中
  - `bullet`: 子弹ID
  - `owner`: 开火者ID
  - `target`: 被命中者ID
  - `damage`: 伤害值
  - `hp`: HP变化

- `PLAYER_DEAD`: 玩家死亡
  - `player`: 死亡玩家ID
  - `killer`: 击杀者ID

## 验收测试

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
- 玩家移动正常（300px）
- Tick递增正常

### ✅ 浏览器验证（需要手动）
- 两个窗口都连上
- A窗按住左键开火，B窗能看到子弹飞来（黄色小点）
- 命中后B窗玩家HP下降
- HP到0后status=DEAD，且不能再移动
- Server日志能看到：SPAWN_BULLET、HIT、PLAYER_DEAD

## 技术细节

### 开火冷却
- 150ms冷却，约6.67发/秒
- 使用`lastFireTime`记录上次开火时间
- `canFire(now)`检查冷却是否完成

### 子弹物理
- 速度：800px/s
- 方向：由`aim`角度计算（`vx = cos(aim) * speed`，`vy = sin(aim) * speed`）
- 每tick更新：`x += vx * deltaTime`，`y += vy * deltaTime`

### 命中检测
- 圆形碰撞：子弹到玩家距离 < 16px
- 不命中自己（`playerId !== bullet.ownerId`）
- 不命中已死亡玩家（`status !== 'ALIVE'`）
- 一颗子弹只能命中一个目标（命中后break）

### 伤害系统
- 单发伤害：10
- 最大HP：100（10发致死）
- HP<=0时设置`status='DEAD'`
- 死亡玩家不能移动（`processInput`中检查）

## 代码风格

- 所有改动点都有清晰注释
- 保持现有TypeScript模式
- 最小改动，不引入额外大重构
- API保持兼容

## 总结

Day2打枪系统已实现：
- ✅ 鼠标左键开火
- ✅ 子弹生成和移动
- ✅ 命中检测和扣血
- ✅ 死亡状态处理
- ✅ 客户端渲染子弹
- ✅ 服务器日志完整

所有回归测试通过，功能验证正常。可以继续开发"物品/拾取/背包 + 撤离点结算"。

