# ZIYANG PROTOCOL

2D 俯视角多人撤离射击游戏（extraction shooter）。线上地址：https://game.ziy.bio

## 项目简介

搜刮、交火、带着战利品活着离场。死了就把身上所有东西留在原地。

界面支持中英双语，默认英文，首次进入会询问语言。

## 技术栈

- **Monorepo**: npm workspaces
- **TypeScript**: 全栈TypeScript
- **Client**: Vite + Canvas 2D
- **Server**: Node.js + WebSocket (ws)
- **Shared**: Zod协议校验 + 数学工具 + 共享逻辑

## 环境要求

- Node.js >= 18

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

| 按键 | 作用 |
|------|------|
| `W/A/S/D` | 移动 |
| 鼠标移动 | 瞄准 |
| 鼠标左键 | 开火 / 近战挥击 |
| `R` | 换弹（打空后再点一次左键也会自动换） |
| `E` | 拾取物品或掉落包（半径仅 40px，要走到几乎踩上去） |
| `空格` | 冲刺（耐力耗尽后需回到 35% 才能再冲） |
| `1`-`5` | 使用道具；投掷物会先进入瞄准模式，再左键投出 / 右键取消 |
| `F1` | 开关右侧信息面板 |
| `/` | 聊天与命令 |

**撤离不需要按键**：走进绿色撤离区，连续停留 5 秒即可，中途离开会归零重来。

**箱子和门要用枪打碎**，`E` 只能拾取。

新玩家首次进入会有引导，之后可以从藏身处右下角的「战场手册」重新查看。

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
ziyang-protocol/
├── shared/          # 共享代码（协议、类型、工具、i18n 词条）
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
- ✅ 中英双语（英文为源语言，词条见 `shared/src/i18n/locales/`）
- ✅ 新手引导与战场手册

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
