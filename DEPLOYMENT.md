# 部署指南

本项目部署在 **Fly.io**，采用「单域名全栈」架构：同一个进程、同一个端口，既托管前端静态资源，也提供 WebSocket 游戏服务。

- 线上地址：https://game.ziy.bio （Fly 默认域名：https://jerkie-man.fly.dev）
- 区域：`sin`（新加坡）
- 应用名：`jerkie-man`

> 应用名和持久卷名沿用了项目改名前的旧标识。Fly 不支持重命名应用，换名字等于重建
> 应用、重建卷、重新签证书并切换 DNS；而这个名字玩家看不到（对外只有 game.ziy.bio），
> 因此保留原样。

## 架构说明

```
浏览器 ──HTTPS──> Fly Proxy ──> 单个 Node 进程 (:8080)
                                  ├── sirv  → client/dist 静态资源（含 BGM，支持 Range）
                                  └── ws    → WebSocket 游戏服务（20Hz tick）
```

前端通过**同源**连接 WebSocket（`wss://<当前域名>`），无需配置服务器地址。
本地开发时客户端会自动回退到 `ws://<hostname>:18723`。

### 为什么不用 Serverless（Vercel / Netlify / Cloudflare Workers）

游戏服务端是**有状态长连接**服务：房间、玩家、子弹全部存活在进程内存中，并以 20Hz 持续推进。
Serverless 函数无法维持长连接、也不保留内存状态，因此只能使用常驻容器。

同理，**实例数必须固定为 1**（`--ha=false` + `auto_stop_machines = false`）。
多实例会让玩家被负载均衡分到不同进程，彼此看不见对方。

## 自动部署

推送到 `main` 分支即自动部署（见 `.github/workflows/deploy.yml`）。
依赖仓库 Secret：`FLY_API_TOKEN`。

## 手动部署

```bash
fly deploy --remote-only --ha=false
```

## 环境变量与 Secret

| 名称 | 用途 | 设置方式 |
|------|------|----------|
| `ADMIN_PASSWORD` | 管理员口令。**未设置时管理员登录整体禁用** | `fly secrets set ADMIN_PASSWORD=...` |
| `PORT` | 监听端口，默认 8080 | 已在 `fly.toml` 配置 |
| `MAP_TEMPLATE` | 指定地图模板，留空则随机 | `fly secrets set` 或 `fly.toml` |
| `CLIENT_DIR` | 静态资源目录，默认 `client/dist` | 一般无需设置 |

> 安全提示：管理员口令**绝不要写进代码**。仓库中曾硬编码过一个默认口令，已从全部历史中清除。

## 数据持久化

玩家档案 `server/data/profiles.json` 存放在 Fly 持久卷 `jerkie_data`（1GB，挂载于 `/app/server/data`），
机器重启或重新部署都不会丢失。

```bash
fly volumes list -a jerkie-man          # 查看卷
fly ssh console -a jerkie-man           # 进入容器
```

## 运维命令

```bash
fly status  -a jerkie-man               # 应用与机器状态
fly logs    -a jerkie-man               # 实时日志
fly machine restart <id> -a jerkie-man  # 重启
fly certs check game.ziy.bio -a jerkie-man   # 证书状态
```

## 自定义域名

DNS 记录（在域名服务商处配置）：

| 类型 | 主机名 | 值 |
|------|--------|-----|
| `A` | `game` | `66.241.125.88` |
| `AAAA` | `game` | `2a09:8280:1::177:5b42:0` |

添加后 Fly 自动完成 Let's Encrypt 验证：

```bash
fly certs add game.ziy.bio -a jerkie-man
```
