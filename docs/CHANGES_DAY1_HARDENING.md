# Day1 加固包 - 变更清单

## 概述

本次加固包针对协议统一、重连状态清理、输入发送频率、Canvas resize、Debug开关等关键点进行系统性加固，确保Day1 MVP的稳定性和可维护性。

## 变更文件列表

### A. 协议统一（P0）

#### 1. `shared/src/protocol.ts`
- **变更**：添加`S2C_WELCOME_SCHEMA`到协议schema
- **要点**：
  - 新增`S2C_WELCOME_SCHEMA`定义
  - 将`S2C_WELCOME_SCHEMA`加入`S2C_MESSAGE_SCHEMA`的discriminatedUnion
  - 导出`S2C_WELCOME`类型
- **验证**：`npm run build`通过，所有消息类型统一通过schema解析

#### 2. `client/src/network.ts`
- **变更**：删除`raw.type === 'S2C_WELCOME'`特判，统一通过schema解析
- **要点**：
  - 所有消息统一通过`S2C_MESSAGE_SCHEMA.parse()`解析
  - 未知消息类型策略：静默忽略（console.warn，避免刷屏）
  - 连接时重置`lastServerTick = 0`和`snapshotBuffer.clear()`
- **验证**：消息解析统一，无特判分支

#### 3. `server/src/main.ts`
- **变更**：使用`S2C_WELCOME_SCHEMA.parse()`发送WELCOME消息
- **要点**：确保发送的消息符合schema定义
- **验证**：构建通过

#### 4. `server/src/smoke.ts`
- **变更**：删除`raw.type === 'S2C_WELCOME'`特判，统一通过schema解析
- **要点**：与client/server保持一致的消息解析策略
- **验证**：smoke test通过

### B. 重连状态清理（P0）

#### 1. `client/src/snapshot.ts`
- **变更**：添加`clear()`方法
- **要点**：清空snapshot buffer，避免旧数据混入
- **验证**：方法存在且可调用

#### 2. `client/src/network.ts`
- **变更**：在`ws.onopen`时重置状态
- **要点**：
  - `lastServerTick = 0`
  - `snapshotBuffer.clear()`
- **验证**：重连后状态正确重置

#### 3. `client/src/main.ts`
- **变更**：在`onDisconnect`时清理状态
- **要点**：
  - `localPlayerId = null`
  - `selectedEntity = null`
- **验证**：断线重连后不会显示错误的选中实体

### C. 输入发送频率 & 队列保护（P1）

#### 1. `client/src/main.ts`
- **变更**：输入发送节流到25Hz（40ms间隔）
- **要点**：
  - 常量`INPUT_SEND_INTERVAL_MS = 40`
  - 只在keys/aim变化时发送（避免无效发送）
  - 保存`lastSentKeys`和`lastSentAim`用于变化检测
- **验证**：输入发送频率控制在25Hz左右

#### 2. `server/src/main.ts`
- **变更**：输入队列保护
- **要点**：
  - 队列最大长度32（`INPUT_QUEUE_MAX_LENGTH`）
  - 超过时丢弃旧的，保留新的
  - 警告日志节流（每5秒最多一次）
  - 每tick只处理最新输入（避免积压）
- **验证**：队列不会无限增长，处理性能稳定

### D. Canvas resize 单一真相（P1）

#### 1. `client/src/renderer.ts`
- **变更**：添加`resize(cssWidth, cssHeight)`方法
- **要点**：
  - 统一负责backing store、DPR、transform设置
  - 删除`setupCanvas()`，逻辑移到`resize()`
- **验证**：resize后坐标转换正确

#### 2. `client/src/main.ts`
- **变更**：不再直接修改`canvas.width/height`
- **要点**：
  - 只设置CSS尺寸（通过`renderer.resize()`）
  - `updateCanvasSize()`调用`renderer.resize()`
- **验证**：resize逻辑单一，无重复设置

### E. Debug开关（P2）

#### 1. `client/src/main.ts`
- **变更**：添加debug开关
- **要点**：
  - 从URL参数`?debug=1`读取
  - 仅在debug模式下打印节流日志
  - 仅在debug模式下渲染坐标文本
- **验证**：默认无噪音日志，debug模式可启用

#### 2. `client/src/renderer.ts`
- **变更**：`render()`方法接受`debug`参数
- **要点**：仅在debug模式下显示坐标文本
- **验证**：默认不显示调试信息

### F. 文档 & 测试链路（P2）

#### 1. `README.md`
- **变更**：更新"已知限制"部分
- **要点**：修正"本地玩家ID识别简化（第一个玩家）"为"S2C_WELCOME消息识别"
- **验证**：文档准确反映实现

#### 2. `TEST_REPORT_DAY1.md`
- **变更**：更新验收清单状态
- **要点**：所有smoke test通过的项标记为✅
- **验证**：报告状态与实际一致

#### 3. `tools/dump_key_code.mjs`（新增）
- **变更**：创建代码dump工具
- **要点**：
  - 基于白名单（`tools/dump_allowlist.json`）导出关键文件
  - 支持自定义输出路径、文件大小限制
  - 固定顺序，避免diff混乱
- **验证**：`npm run dump:key`成功生成`dump_key_code.txt`

#### 4. `tools/dump_allowlist.json`（新增）
- **变更**：定义关键文件白名单
- **要点**：包含协议、网络、渲染、服务端、测试、文档等关键文件
- **验证**：dump工具能正确读取

## 验证步骤

### 1. 构建验证
```powershell
npm run build
```
**预期**：所有包构建成功，无类型错误

### 2. Smoke Test验证
```powershell
# 确保server在运行（或使用改进后的smoke test自动启动）
npm run test:smoke
```
**预期**：
- 两个客户端成功连接
- 收到足够数量的snapshots
- 玩家移动距离>10px（实际约290px）
- 测试通过

### 3. 浏览器验证
```powershell
npm run dev:all
# 打开两个浏览器窗口访问 http://localhost:5173
# 窗口1按WASD，窗口2应该能看到同步移动
```
**预期**：
- 两个窗口都能看到2个玩家
- 移动同步正常
- HUD显示正确

### 4. Debug模式验证
```powershell
# 访问 http://localhost:5173?debug=1
```
**预期**：
- 控制台有节流日志输出
- Canvas上显示本地玩家坐标文本

### 5. 代码Dump验证
```powershell
npm run dump:key
```
**预期**：生成`dump_key_code.txt`，包含所有关键文件

## 输入处理策略说明

**最终采用的规则**：
- 客户端：25Hz发送频率（40ms间隔），只在keys/aim变化时发送
- 服务端：每tick只处理最新输入（seq最大的），队列最大32
- 去重：只使用`seq`字段，不检查`tick`字段
- 理由：简化逻辑，避免积压，保证性能

## 消息解析策略说明

**统一策略**：
- 所有消息（包括S2C_WELCOME）统一通过`S2C_MESSAGE_SCHEMA.parse()`解析
- 未知消息类型：静默忽略（console.warn，避免刷屏）
- 解析失败：静默忽略（避免恶意消息导致崩溃）

## 总结

本次加固包完成了：
- ✅ 协议统一（S2C_WELCOME正式加入schema）
- ✅ 重连状态清理（避免幽灵数据）
- ✅ 输入发送频率控制（25Hz，变化检测）
- ✅ 服务端队列保护（最大32，只处理最新）
- ✅ Canvas resize单一真相（Renderer统一管理）
- ✅ Debug开关（?debug=1）
- ✅ 文档更新（README、TEST_REPORT）
- ✅ 代码dump工具（便于code review）

所有变更均为"最小可控修改"，未引入大改架构。构建和smoke test均通过。

