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

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS production
WORKDIR /app

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

CMD ["node", "dist/index.js"]
