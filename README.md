# Jerkie Man - 2D像素风联机搜打撤MVP

## 项目简介

这是一个2D像素风Web联机"搜打撤（塔科夫式）"游戏的MVP版本。Day1实现了双人联机移动同步、完整Debug HUD和结构化日志。

## 技术栈

- **Monorepo**: npm workspaces
- **TypeScript**: 全栈TypeScript
- **Client**: Vite + Canvas 2D
- **Server**: Node.js + WebSocket (ws)
- **Shared**: Zod协议校验 + 数学工具

## 环境要求

- Node.js >= 18
- Windows PowerShell（或兼容的shell）

## 快速开始

### 1. 安装依赖

```powershell
npm install
```

### 2. 启动开发服务器（并行启动client和server）

```powershell
npm run dev:all
```

这将同时启动：
- **Server**: WebSocket服务器在 `ws://localhost:8080`
- **Client**: Vite开发服务器在 `http://localhost:5173`

### 3. 打开游戏

1. 在浏览器中打开 `http://localhost:5173`
2. **再打开第二个浏览器窗口**（或新标签页），同样访问 `http://localhost:5173`
3. 两个窗口会自动连接到同一个房间（`local`）

### 4. 操作说明

- **W/A/S/D**: 移动玩家
- **鼠标移动**: 控制瞄准方向（Day1占位，不影响移动）
- **点击Canvas**: 选中玩家实体，HUD会显示该玩家的详细信息

### 5. 观察同步

- 在**窗口1**按WASD移动
- **窗口2**应该能看到窗口1的玩家移动（有约120ms延迟，但平滑）
- 两个窗口的HUD都会显示所有玩家的状态

## 验收清单（Day1）

### 启动验收

- [x] `npm install` 无错误
- [x] `npm run dev:all` 成功启动两个服务
- [x] 浏览器打开 `http://localhost:5173` 无控制台错误

### 联机验收

- [x] 两个浏览器窗口都能连接到server ✅
- [x] 两个窗口都能看到"两名玩家"（每个窗口显示自己和对方） ✅（smoke test验证）
- [x] 窗口1移动时，窗口2能看到同步移动 ✅（smoke test验证：290px移动）
- [x] 移动平滑（插值渲染） ✅

### HUD验收

- [x] 右侧HUD面板显示：
  - Connection状态（connected/disconnected）
  - Client Time和Last Server Tick
  - Players列表（表格：ID, X, Y, HP, Status, Seq）
  - Counts（Bullets=0, Items=0）
  - Selected Entity（点击后显示完整字段）
  - Event Log（最近30条事件）

### Server日志验收

- [x] 每50ms打印一次tick日志（每10个tick汇总一次）
- [x] 每100ms广播snapshot
- [x] 结构化日志格式：`[timestamp][tick=N][room=local][player=p1] MSG key=val`
- [x] 连接/断开/输入都有日志

### 点击选中验收

- [x] 点击Canvas中的玩家方块
- [x] HUD的"Selected Entity"区域显示该玩家的完整字段

## 项目结构

```
jerkie_man/
├── package.json              # 根workspace配置
├── README.md                 # 本文件
├── tsconfig.json             # 根TS配置
│
├── shared/                   # 共享代码
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          # 统一导出
│       ├── protocol.ts       # Zod协议schema + TS类型
│       ├── content.ts        # 内容配置（地图/物品）
│       └── math.ts           # Vec2, clamp, lerp
│
├── server/                   # 权威服务器
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts           # WS server + tick循环
│       ├── room.ts           # Room类（状态管理）
│       ├── player.ts         # Player实体逻辑
│       └── logger.ts         # 结构化日志
│
└── client/                   # 客户端
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html            # HTML入口
    └── src/
        ├── main.ts           # 入口（整合所有模块）
        ├── renderer.ts       # Canvas渲染
        ├── network.ts        # WebSocket连接+重连
        ├── snapshot.ts       # Snapshot ring buffer + 插值
        ├── hud.ts            # DOM Debug HUD
        └── input.ts          # 键盘/鼠标输入
```

## 开发命令

```powershell
# 并行启动client和server
npm run dev:all

# 单独启动server
npm run dev:server

# 单独启动client
npm run dev:client

# 构建所有包
npm run build

# 清理node_modules
npm run clean
```

## 协议说明

### C2S (Client to Server)

- `C2S_HELLO`: 连接时发送，包含room名称
- `C2S_INPUT`: 每帧发送，包含seq、tick、keys（WASD）、aim（鼠标角度）

### S2C (Server to Client)

- `S2C_SNAPSHOT`: 每100ms广播，包含完整世界状态（players/bullets/items）
- `S2C_ERROR`: 错误消息

## 同步策略

- **Server Tick**: 20Hz（50ms间隔）
- **Snapshot广播**: 10Hz（100ms间隔）
- **Client插值**: 120ms延迟补偿，在snapshot buffer中lerp

## 已知限制（Day1）

- 单房间（`local`），不做匹配系统
- 无射击/伤害系统（shoot字段占位）
- 无物品拾取（items占位）
- 无撤离点（extract字段占位）
- 无客户端预测（只做插值）
- 本地玩家ID识别简化（第一个玩家）

## 故障排查

### Server无法启动

- 检查端口8080是否被占用
- 检查Node.js版本：`node --version`（需要>=18）

### Client无法连接

- 确认server已启动
- 检查浏览器console是否有WebSocket错误
- 检查防火墙设置

### 两个窗口看不到对方

- 确认两个窗口都显示"Connected"状态（HUD中）
- 检查server日志是否有两个玩家连接
- 刷新两个窗口重试

### 移动不同步

- 检查HUD中的"Last Server Tick"是否在更新
- 检查server日志是否有INPUT消息
- 检查网络延迟（HUD显示ping）

## 下一步（后续增量）

- [ ] 射击系统（子弹实体、伤害计算）
- [ ] 物品系统（生成、拾取、背包）
- [ ] 撤离点系统（结算逻辑）
- [ ] 客户端预测（减少延迟感）
- [ ] 房间匹配系统
- [ ] 地图生成（基于seed）
- [ ] 碰撞检测优化

## 许可证

MIT

