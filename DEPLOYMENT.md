# 部署指南

本项目采用前后端分离部署：
- **Client（前端）**: GitHub Pages
- **Server（后端）**: Render

## 部署步骤

### 1. 部署 Server 到 Render

1. 访问 [Render](https://render.com) 并注册/登录
2. 点击 "New +" → "Web Service"
3. 连接你的 GitHub 仓库
4. Render 会自动检测到 `render.yaml` 配置文件
5. 点击 "Apply" 创建服务
6. 等待部署完成，记下你的服务地址（例如：`https://jerkie-man-server.onrender.com`）

**注意事项：**
- Render 免费套餐在 15 分钟无活动后会休眠，首次访问需要等待唤醒（约 30-60 秒）
- 免费套餐每月有 750 小时的运行时间限制

### 2. 配置 GitHub Actions

1. 修改 `.github/workflows/deploy.yml` 中的 `VITE_SERVER_URL`：
   ```yaml
   VITE_SERVER_URL: 'wss://你的render服务地址.onrender.com'
   ```

2. 修改 `client/vite.config.ts` 中的 `base` 路径为你的仓库名：
   ```typescript
   base: process.env.GITHUB_PAGES === 'true' ? '/你的仓库名/' : '/',
   ```

### 3. 启用 GitHub Pages

1. 将代码推送到 GitHub 的 main 分支
2. 访问仓库设置：`https://github.com/你的用户名/你的仓库名/settings/pages`
3. 在 "Build and deployment" 下，将 "Source" 设置为 "GitHub Actions"
4. 等待 GitHub Actions 自动构建和部署

### 4. 访问你的游戏

部署完成后，访问：`https://你的用户名.github.io/你的仓库名/`

## 本地开发

本地开发时，client 会自动连接到 `localhost:18723`：

```bash
# 启动 server 和 client
npm run dev

# 或分别启动
npm run dev:server
npm run dev:client
```

## 环境变量说明

- `GITHUB_PAGES`: 设置为 'true' 时启用 GitHub Pages 路径配置
- `VITE_SERVER_URL`: 生产环境的 WebSocket 服务器地址（例如：`wss://your-server.onrender.com`）

## 故障排查

### Client 无法连接到 Server
1. 检查浏览器控制台的 WebSocket 连接错误
2. 确认 Render 服务是否正常运行（访问 Render Dashboard）
3. 确认 `VITE_SERVER_URL` 配置正确（注意使用 `wss://` 而不是 `https://`）

### Render 服务休眠
Render 免费套餐会在 15 分钟无活动后休眠。首次访问时：
1. 打开游戏页面
2. 等待 30-60 秒让 Render 服务唤醒
3. 刷新页面重新连接

### GitHub Actions 构建失败
1. 检查 Actions 日志：`https://github.com/你的用户名/你的仓库名/actions`
2. 确认所有依赖都在 `package.json` 中正确声明
3. 确认 Node.js 版本兼容（workflow 使用 Node 20）
