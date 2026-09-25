# Build from the repo root:  docker build -f server/Dockerfile -t cloudvault .
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
