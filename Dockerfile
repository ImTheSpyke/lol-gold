# syntax=docker/dockerfile:1
#
# Linux image for the dashboard / API.
#
# NOTE: node-screenshots captures Win32 windows and cannot work inside a Linux
# container — OCR capture is disabled there and the app runs in graph-only
# mode. For live capture, run the app directly on the Windows host
# (`npm run build && npm start`) and use Docker only for MariaDB.
#
# DB credentials are supplied exclusively via environment variables.

ARG NODE_VERSION=26

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS production
WORKDIR /app

# Fonts for server-side chart rendering (PNG export); slim ships none.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY public/ ./public/

# config.json lives in /app/data, bind-mounted from the host at runtime
RUN mkdir -p /app/data

ENV NODE_ENV=production \
    CONFIG_DIR=/app/data \
    PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/index.js"]
