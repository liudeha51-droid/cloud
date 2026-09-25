# Build from the repo root:  docker build -f server/Dockerfile -t cloudvault .
# 在仓库根目录构建：       docker build -f server/Dockerfile -t cloudvault .
# Runs as the unprivileged "node" user; data lives in the /data volume.
# 以非特权用户 "node" 运行；数据保存在 /data 卷中。
FROM node:22-alpine
WORKDIR /srv
COPY server/server.js server/server.js
COPY app app
ENV PORT=8787 CLOUDVAULT_DATA=/data NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/server.js"]
