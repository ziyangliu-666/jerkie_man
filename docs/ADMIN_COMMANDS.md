# 管理员命令文档

## 客户端命令

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt+Shift+R` | 重置账号并重新连接（清空进度） |
| `Alt+Shift+D` | 显示调试信息 |
| `Alt+Shift+S` | 请求服务器状态（通过网络） |
| `Alt+Shift+W` | 重置服务端世界（需确认） |
| `` ` `` (反引号) | 复制调试日志到剪贴板（仅 debug 模式） |

### 控制台命令

在浏览器控制台输入：

```javascript
// 显示帮助
__admin.help()

// 重新连接服务器
__admin.reconnect()

// 清空本地账号ID（下次连接创建新账号）
__admin.resetAccount()

// 显示当前账号信息
__admin.showAccount()

// 显示当前玩家状态
__admin.showPlayer()

// 显示所有玩家和世界物品
__admin.showAllPlayers()

// 显示地图配置
__admin.showMap()

// 请求服务器状态（通过网络发送到服务端）
__admin.requestServerStatus()

// 重置服务端世界（需确认，会断开所有连接）
__admin.resetServerWorld()
```

### 常见调试场景

#### 场景1：测试新账号

```javascript
__admin.resetAccount()  // 清空账号ID
__admin.reconnect()     // 重新连接（创建新账号）
```

或者直接按 `Alt+Shift+R`

#### 场景2：查看当前状态

```javascript
__admin.showAccount()   // 查看账号和 Profile
__admin.showPlayer()    // 查看玩家位置、血量等
```

或者直接按 `Alt+Shift+D`

#### 场景3：调试世界物品

```javascript
__admin.showAllPlayers()  // 查看所有玩家、世界物品、掉落包
__admin.showMap()         // 查看地图配置、种子、障碍物
```

## 服务端命令

### 方法1：通过客户端触发（推荐）

使用快捷键或控制台命令：

```javascript
// 快捷键
Alt+Shift+S  // 查看服务器状态
Alt+Shift+W  // 重置服务端世界

// 或在浏览器控制台
__admin.requestServerStatus()  // 查看服务器状态
__admin.resetServerWorld()     // 重置服务端世界
```

服务端会通过 HUD Event Log 返回结果。

### 方法2：直接在服务端控制台（Node.js REPL）

**注意**：如果你使用 `npm run dev:all` 启动，无法直接输入命令。需要：

1. 停止 `dev:all`
2. 打开新终端，运行 `cd server && npm run dev`
3. 在服务端终端按 `Ctrl+C` 一次进入 REPL 模式

然后输入：

```javascript
// 显示帮助
admin.help()

// 显示房间状态
admin.showRoom()

// 显示所有在线玩家
admin.showPlayers()

// 显示 Profile 信息
admin.showProfiles()

// 重置整个房间（断开所有连接，重新生成世界）
admin.resetRoom()
```

### 常见调试场景

#### 场景1：重置世界

```javascript
admin.resetRoom()  // 重置房间，生成新的地图种子
```

客户端会自动断线，刷新页面即可重新连接。

#### 场景2：查看服务器状态

```javascript
admin.showRoom()     // 查看 tick、玩家数量等
admin.showPlayers()  // 查看所有玩家的详细信息
```

#### 场景3：手动清空 Profile

直接删除或编辑 `server/data/profiles.json` 文件，然后重启服务器。

## 数据持久化

### 客户端

- **账号ID**: 存储在 `localStorage.zp_account_id`
- **清空方法**: `__admin.resetAccount()` 或 `Alt+Shift+R`

### 服务端

- **Profile数据**: 存储在 `server/data/profiles.json`
- **清空方法**: 删除文件或使用 `admin.resetRoom()`（不清空 Profile）

## 注意事项

1. **账号ID** 是客户端生成的 UUID，存储在 localStorage 中
2. **Profile** (金钱、仓库) 绑定到 accountId，跨连接持久化
3. **playerId** 是每次连接生成的临时ID，断线后失效
4. 重置账号会清空本地 accountId，但服务端的旧 Profile 数据仍然保留在 `profiles.json` 中
5. 服务端 `admin.resetRoom()` 会重新生成世界，但不会清空 Profile 数据
6. 快捷键使用 `Alt+Shift` 组合，避免与浏览器默认快捷键冲突

## 开发建议

- 使用 `?debug=1` URL 参数启用调试模式（显示客户端 tick 日志）
- 使用 `SEED=12345` 环境变量固定服务端地图种子（便于复现 bug）
- 使用 `Alt+Shift+D` 快速查看当前状态
- 使用 `` ` `` 快速复制调试日志（debug 模式）

