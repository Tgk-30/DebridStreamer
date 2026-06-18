# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS web-build
WORKDIR /repo/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-bookworm-slim AS server-build
WORKDIR /repo
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY server/ ./server/
COPY web/src/models ./web/src/models
COPY web/src/services/debrid ./web/src/services/debrid
COPY web/src/services/indexers ./web/src/services/indexers
RUN cd server && npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=43110
ENV DS_SERVER_DATA_DIR=/data
ENV DS_SERVER_DB_PATH=/data/debridstreamer.sqlite
ENV DS_WEB_DIST=/app/web-dist
WORKDIR /app

COPY --from=server-build /repo/server/dist ./server/dist
COPY --from=web-build /repo/web/dist ./web-dist

VOLUME ["/data"]
EXPOSE 43110
CMD ["node", "server/dist/index.cjs"]
