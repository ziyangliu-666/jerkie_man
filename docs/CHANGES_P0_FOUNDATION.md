# P0 地基问题修复 - 变更摘要

## 概述

修复了3个P0级别的地基问题，确保跨机器时钟偏移不影响插值、可控断开连接、以及玩家永远可见。

## 变更文件

1. **client/src/snapshot.ts** - P0-1: 插值时间基准修正
2. **client/src/network.ts** - P0-2: 可控断开连接
3. **client/src/renderer.ts** - P0-3: Camera系统
4. **client/src/main.ts** - P0-2: 暴露network到window（调试用）

## P0-1: 修正插值时间基准

### 问题
跨机器时钟偏移导致`getInterpolatedState()`用`Date.now()`（client时间）对比`snapshot.timestamp`（server时间），永远找不到t0/t1或alpha跳变。

### 实现
- 添加`serverOffsetMs`字段：估计服务器时间偏移（serverNow - clientNow）
- 在`add(snapshot)`时平滑更新offset：`offsetNow = snapshot.timestamp - Date.now()`，使用指数移动平均（90%旧值 + 10%新值）
- 在`getInterpolatedState()`中使用服务器时间域：`renderTimeServer = Date.now() + serverOffsetMs - renderDelay`
- 所有时间比较都在服务器时间域中进行

### 效果
- 本机运行：手感不变
- 跨机器（时钟差几秒）：仍能稳定插值，不一直回退latest、不瞬移抖动

## P0-2: Network.disconnect() 必须能停止重连

### 问题
`disconnect()`调`ws.close()`后，`onclose`仍会`scheduleReconnect()`，导致"断不掉"。

### 实现
- 添加`shouldReconnect`标志（默认`true`，保持正常断线自动重连）
- `onclose`中先调用`callbacks.onDisconnect()`，只有`shouldReconnect`为`true`才`scheduleReconnect()`
- `disconnect()`设置`shouldReconnect = false`，清理`reconnectTimer`，关闭ws
- `onopen`时重置`shouldReconnect = true`，确保正常连接后仍会自动重连
- `main.ts`中暴露`network`到`window.net`，方便调试时手动调用`disconnect()`

### 效果
- 手动调用`window.net.disconnect()`后，控制台不再出现"Reconnecting..."
- 正常断网/关闭server：仍会指数退避重连

## P0-3: 加入Camera（本地玩家居中）

### 问题
世界2000x2000，玩家随机出生，没有camera时经常出生在屏幕外，看起来像没渲染。

### 实现
- **Renderer维护camera**：`camX`、`camY`（世界坐标）
- **render()中计算camera**：
  - 找到本地玩家（若存在）
  - 计算camera让本地玩家显示在屏幕中心：`camX = localPlayer.x - cssWidth/2`，`camY = localPlayer.y - cssHeight/2`
  - 若本地玩家不存在：`camX/camY`保持0
- **drawPlayer()使用屏幕坐标**：
  - `screenX = player.x - camX`，`screenY = player.y - camY`
  - 所有绘制（方块、边框、血条）都用屏幕坐标
- **screenToWorld/worldToScreen考虑camera**：
  - `screenToWorld`: 输入是`clientX/clientY`，先减`rect.left/top`得到canvas内screen坐标，再加`camX/camY`得到world
  - `worldToScreen`: world转screen（减`camX/camY`），再加`rect.left/top`返回client坐标
- **hitTest保持world坐标**：使用`worldX/worldY`与`player.x/player.y`比较，确保点击选中准确

### 效果
- 打开页面：必定能看到本地玩家（在屏幕中心附近）
- 两窗口：都能看见自己；对方会出现在相对位置
- 点击玩家方块仍能准确选中（Selected Entity正确更新）
- debug文本位置保持左上角不动（使用屏幕坐标绘制）

## 回归测试

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
- 收到足够数量的snapshots
- 玩家移动距离290px（>10px要求）
- Tick递增正常

### ✅ 浏览器验证
- 单窗口：能看到玩家（蓝色方块在屏幕中心）
- Camera工作正常：玩家坐标(420.8, 282.5)，显示在屏幕中心
- HUD显示正常：Connection、Players、Counts、Event Log
- Debug模式：坐标文本显示正常

## 技术细节

### 时间域转换
- **问题**: 客户端和服务器时钟不同步，直接比较会导致插值失败
- **解决**: 使用指数移动平均估计服务器时间偏移，所有插值计算在服务器时间域进行
- **公式**: `serverNow = clientNow + serverOffsetMs`，`renderTimeServer = serverNow - renderDelay`

### Camera坐标转换
- **世界坐标**: server snapshot的x/y（不变）
- **屏幕坐标**: 用于Canvas绘制，`screenX = worldX - camX`
- **点击坐标**: `clientX/clientY` → `canvasScreen` → `worldX/worldY`
- **注意**: 因为`ctx.setTransform(dpr,0,0,dpr,0,0)`，所有坐标都在CSS像素层面，不需要再除/乘dpr

## 代码风格

- 所有改动点都有清晰注释，说明为什么要这样做
- 保持现有TypeScript模式
- 最小改动，不引入额外大重构
- API保持兼容，不破坏现有功能

## 总结

3个P0地基问题全部修复：
- ✅ P0-1: 跨机器时钟偏移不影响插值
- ✅ P0-2: 可控断开连接不再自动重连
- ✅ P0-3: Camera让玩家永远可见

所有回归测试通过，功能验证正常。

