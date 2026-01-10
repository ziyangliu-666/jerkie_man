# 私有服务器自动部署指南

本项目采用 **GitHub Actions** 进行 CI/CD，自动构建并部署到私有服务器（CentOS/Ubuntu）。

## 架构说明
- **前端 (Client)**: 纯静态文件，构建后推送至服务器，由 Nginx 托管。
    - **部署路径**: `~/jerkie_man/client`
    - **访问端口**: `5174` (Nginx)
    - **后端连接**: 自动连接 `ws://<当前网页IP>:18723`，无需配置。
- **后端 (Server)**: Node.js 应用，构建后推送至服务器，由 PM2 管理进程。
    - **部署路径**: `~/jerkie_man/server`
    - **运行端口**: `18723` (WebSocket)

## 1. 自动化部署流程
每次向 `main` 分支推送代码时，GitHub Actions 会自动执行：
1. **构建**: 在 CI 环境中打包 shared, server, client 代码。
2. **传输**: 通过 SCP 将构建产物覆盖到服务器的 `~/jerkie_man` 目录。
3. **重启**:
    - 安装后端依赖 (`npm install --production`)
    - 检查 PM2 进程：如果存在则 `restart`，不存在则 `start`。

## 2. 服务器环境准备 (只需一次)

### 安装 Node.js (v18+) & PM2
因为项目使用了较新的语法，服务器必须安装 Node.js v18 或更高版本。
```bash
# 安装 Node.js 20 (推荐)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# 安装 PM2 进程管理器
npm install -g pm2
```

### 安装与配置 Nginx
前端页面需要 Web 服务器托管。
```bash
# 1. 安装 Nginx
sudo yum install nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# 2. 配置 Nginx
# 创建配置文件: /etc/nginx/conf.d/jerkie_man.conf
server {
    listen 5174;
    server_name _;

    root /root/jerkie_man/client; # 注意：确保此目录有读取权限
    index index.html;
    
    # 开启 Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# 3. 解决权限问题 (如果部署在 /root 下)
# 必须赋予 Nginx 读取权限，否则报 403/502
chmod o+x /root
chmod o+x /root/jerkie_man
chmod o+x /root/jerkie_man/client

# 4. 重载配置
sudo nginx -t
sudo systemctl reload nginx
```

### 配置防火墙 (重要!)
必须同时开放 **系统防火墙** 和 **云厂商安全组**。
```bash
# CentOS firewalld
sudo firewall-cmd --permanent --add-port=5174/tcp   # 前端网页
sudo firewall-cmd --permanent --add-port=18723/tcp  # 游戏连接
sudo firewall-cmd --reload
```
**别忘了去阿里云/腾讯云控制台的安全组里放行这两个端口！**

## 3. 运维命令

```bash
# 查看后端状态
pm2 list
pm2 logs jerkie-server
pm2 monit

# 手动重启后端
pm2 restart jerkie-server

# 查看 Nginx 日志 (前端网页打不开时)
tail -f /var/log/nginx/error.log
tail -f /var/log/nginx/access.log
```
