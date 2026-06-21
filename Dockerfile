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
# The server bundles web TypeScript via esbuild — its runtime shims import from
# web/src/{models,services/{ai,debrid,indexers,metadata,subtitles}}. Copy the
# whole web/src so every current (and future) cross-import resolves; this is a
# build stage only, so it never bloats the runtime image.
COPY web/src ./web/src
RUN cd server && npm run build

# NOTE: the optional server-side HLS transcoding feature (DS_SERVER_TRANSCODE…,
# default OFF) shells out to `ffmpeg`. This slim image does NOT ship ffmpeg; if
# you enable transcoding, base the runtime stage on an ffmpeg-equipped image or
# add `RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg`.
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
