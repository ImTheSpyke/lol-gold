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

# A font for server-side chart rendering (PNG export); slim ships none.
# @napi-rs/canvas scans /usr/share/fonts itself, so fontconfig is not needed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# One RUN so nothing removed below survives in an earlier layer:
#  - onnxruntime-node ships every OS/arch binary plus the CUDA/TensorRT providers
#    (~270 MB, GPU only); the app runs on the CPU provider, so keep only that
#  - node-screenshots is Win32-only and never loads on Linux
#  - drop docs/sourcemaps/typings and the unused npm/corepack toolchain
ARG TARGETARCH
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev \
 && case "${TARGETARCH:-amd64}" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac \
 && cd node_modules/onnxruntime-node/bin/napi-v6 \
 && for os in *; do \
      if [ "$os" = linux ]; then \
        for a in "$os"/*; do [ "$a" = "linux/$ARCH" ] || rm -rf "$a"; done; \
      else rm -rf "$os"; fi; \
    done \
 && cd /app \
 && rm -rf node_modules/node-screenshots node_modules/node-screenshots-* \
 && find node_modules \( -name '*.map' -o -name '*.md' -o -name '*.d.ts' -o -name '*.d.mts' \
        -o -name '*.markdown' -o -name 'LICENSE*' -o -name 'CHANGELOG*' \) -type f -delete \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

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
