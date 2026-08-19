# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app

# 先只拷 manifest，最大化利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev && npm cache clean --force

# 编译产物
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
# 地图模板在源码目录中按相对路径读取，必须一并带上
COPY shared/maps ./shared/maps

EXPOSE 8080
CMD ["node", "server/dist/main.js"]
