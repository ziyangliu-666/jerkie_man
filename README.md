# Jerkie Man - 2D像素风联机搜打撤游戏

## 项目简介

这是一个2D像素风Web联机"搜打撤"游戏。支持多人联机、射击战斗、物品拾取、撤离系统等核心玩法。

## 技术栈

- **Monorepo**: npm workspaces
- **TypeScript**: 全栈TypeScript
- **Client**: Vite + Canvas 2D
- **Server**: Node.js + WebSocket (ws)
- **Shared**: Zod协议校验 + 数学工具 + 共享逻辑

## 环境要求

- Node.js >= 18
- Windows PowerShell（或兼容的shell）

## 快速开始

### 1. 安装依赖

```powershell
npm install
```

### 2. 启动开发服务器

```powershell
# 并行启动客户端和服务端（推荐）
npm run dev:all
```

这将同时启动：
- **Server**: WebSocket服务器在 `ws://localhost:18723`
- **Client**: Vite开发服务器在 `http://localhost:5173`

### 3. 打开游戏

1. 在浏览器中打开 `http://localhost:5173`
2. 打开第二个浏览器窗口（或新标签页），同样访问 `http://localhost:5173`
3. 两个窗口会自动连接到同一个房间

### 4. 操作说明

- **W/A/S/D**: 移动玩家
- **鼠标移动**: 控制瞄准方向
- **鼠标左键**: 射击
- **R**: 换弹
- **E**: 拾取物品
- **F**: 按住撤离（在撤离点）
- **空格**: 冲刺
- **点击Canvas**: 选中实体，HUD会显示详细信息

## 开发命令

```powershell
# 并行启动（随机地图）
npm run dev:all

# 单独启动
npm run dev:server     # 仅服务端
npm run dev:client     # 仅客户端

# 构建
npm run build          # 构建所有包

# 生产环境启动
npm run start:all      # 启动构建后的服务
npm run start:server   # 仅服务端
npm run start:client   # 仅客户端
```

## 项目结构

```
jerkie_man/
├── shared/          # 共享代码（协议、类型、工具）
├── server/          # 权威服务器（游戏逻辑、状态管理）
├── client/          # 客户端（渲染、输入、网络）
└── tools/           # 工具脚本
```

## 核心功能

- ✅ 多人联机同步（位置、状态）
- ✅ 射击系统（多种武器、子弹物理、伤害计算）
- ✅ 物品系统（拾取、背包、仓库、整备区）
- ✅ 撤离系统（撤离点、进度条）
- ✅ 玩家档案（持久化存储）
- ✅ 商店系统（购买/出售物品）
- ✅ 装备系统（武器、护甲、背包）
- ✅ AI 敌人
- ✅ 地图系统（预设地图 + 随机生成）

## 地图系统

### 使用预设地图

项目包含多个预设地图，可通过环境变量指定：

```powershell
MAP_TEMPLATE=urban_ruins npm run dev:server      # 城市废墟
MAP_TEMPLATE=forest_outpost npm run dev:server   # 森林哨站
MAP_TEMPLATE=example npm run dev:server          # 示例地图
```

### 创建自定义地图

1. 在 `shared/maps/` 目录创建 `.map.txt` 文件
2. 参考 `shared/maps/README.md` 了解格式
3. 使用 `MAP_TEMPLATE=your_map_id npm run dev:server` 加载

## 服务端管理命令

在服务端控制台输入：

```javascript
admin.showRoom()          // 显示房间状态
admin.showPlayers()       // 显示所有玩家
admin.listMapTemplates()  // 列出可用地图
admin.setMapTemplate(id)  // 切换地图（传 null 使用随机生成）
admin.resetRoom()         // 重置房间
admin.help()              // 显示帮助
```

## 同步策略

- **Server Tick**: 20Hz（50ms间隔）
- **Snapshot广播**: 10Hz（100ms间隔）
- **Client输入**: 25Hz（40ms节流）
- **Client插值**: 120ms延迟补偿，平滑渲染

## 故障排查

### Server无法启动
- 检查端口18723是否被占用
- 检查Node.js版本：`node --version`（需要>=18）

### Client无法连接
- 确认server已启动
- 检查浏览器console是否有WebSocket错误
- 检查防火墙设置

### 移动不同步
- 检查HUD中的"Last Server Tick"是否在更新
- 检查server日志是否有INPUT消息
- 检查网络延迟（HUD显示ping）

## 许可证

MIT
