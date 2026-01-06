# Jerkie Man - 2D像素风联机搜打撤MVP

## 项目简介

这是一个2D像素风Web联机"搜打撤（塔科夫式）"游戏的MVP版本。Day1实现了双人联机移动同步、完整Debug HUD和结构化日志。

## 技术栈

### 世界配置（Day4-1）
- **Server 权威配置**：地图配置（mapConfig）和随机种子（seed）由 server 生成并下发
- **Client 使用 server 配置**：client 不再本地生成 mapConfig，使用 server 下发的配置作为单一真相来源
- **兼容模式**：如果 server 未下发 mapConfig，client 会 fallback 到本地配置并显示警告（HUD event）

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

### 2. 启动开发服务器

#### 使用预设地图

```powershell
# 城市废墟地图（推荐）
npm run dev:urban

# 森林哨站地图
npm run dev:forest

# 示例地图
npm run dev:example

# 随机生成地图（默认）
npm run dev:server
```

#### 并行启动（客户端+服务端）

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
# 并行启动client和server（随机地图）
npm run dev:all

# 使用预设地图启动server
npm run dev:urban      # 城市废墟地图
npm run dev:forest     # 森林哨站地图
npm run dev:example    # 示例地图

# 单独启动server（随机地图）
npm run dev:server

# 单独启动client
npm run dev:client

# 构建所有包
npm run build

# 清理node_modules
npm run clean
```

## 地图系统

### 使用预设地图

项目包含多个预设地图：
- **urban_ruins**: 城市废墟，多建筑战术地图
- **forest_outpost**: 森林哨站，军事基地主题
- **example**: 简单示例地图

### 创建自定义地图

1. 在 `shared/maps/` 目录创建 `.map.txt` 文件
2. 参考 `shared/maps/README.md` 了解格式
3. 使用 `MAP_TEMPLATE=your_map_id npm run dev:server` 加载

### 地图格式示例

```
# MAPTEXT v1
@meta id=my_map name="My Map" desc="A custom map"
@map width=2000 height=2000 seed=12345
@extract x=1800 y=1800 w=200 h=200

@obstacle x=300 y=300 w=200 h=150
@spawn x=200 y=200
@poi x=400 y=375 id=building1 type=building name="Main Building"
@zone x=250 y=250 w=400 h=400 id=zone1 type=loot name="Loot Zone"
```

详细文档：`docs/MAP_EDITOR_GUIDE.md`

## 运行时管理

### 服务端管理命令

在服务端控制台输入：

```javascript
// 列出可用地图
admin.listMapTemplates()

// 切换地图（会重置房间）
admin.setMapTemplate('urban_ruins')

// 切换回随机生成
admin.setMapTemplate(null)

// 重新加载地图文件
admin.reloadMapTemplates()

// 显示当前房间信息
admin.showRoom()
```

## 协议说明

### C2S (Client to Server)

- `C2S_HELLO`: 连接时发送，包含room名称
- `C2S_INPUT`: 25Hz节流发送（40ms间隔），只在keys/aim变化时发送，包含seq、tick、keys（WASD）、aim（鼠标角度）

### S2C (Server to Client)

- `S2C_SNAPSHOT`: 每100ms广播，包含完整世界状态（players/bullets/items）
- `S2C_ERROR`: 错误消息

## 同步策略

- **Server Tick**: 20Hz（50ms间隔）
- **Snapshot广播**: 10Hz（100ms间隔）
- **Client插值**: 120ms延迟补偿，在snapshot buffer中lerp

## 已知限制（当前状态）

- 单房间（`local`），不做匹配系统
- ✅ 射击/伤害系统已实现（Day2）：开火、子弹、命中扣血、死亡状态
- 无物品拾取（items占位，计划Day3）
- 无撤离点（extract字段占位，计划Day3）
- 无客户端预测（只做插值）
- ✅ 本地玩家ID识别：通过 `S2C_WELCOME` 消息机制识别

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

- [x] 射击系统（子弹实体、伤害计算）✅ Day2完成
- [ ] 物品系统（生成、拾取、背包）→ Day3计划
- [ ] 撤离点系统（结算逻辑）→ Day3计划
- [ ] 客户端预测（减少延迟感）
- [ ] 房间匹配系统
- [ ] 地图生成（基于seed）
- [ ] 碰撞检测优化

## 许可证

MIT
