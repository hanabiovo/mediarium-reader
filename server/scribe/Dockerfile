# 灵媒 · 誊写服务。很小：一个 Node 进程，内存上限在 compose 里给 128MB
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
ENV NODE_ENV=production PORT=8011 CACHE_DIR=/data/img
# 数据卷第一次建时照镜像里的属主来：先把 /data 给 node，否则卷是 root 的、服务写不进去（2026-10-22 CC 发现：图片缓存从来没写进去过）
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8011
CMD ["node", "src/index.js"]
