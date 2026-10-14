# syntax=docker/dockerfile:1
#
# Standard Linux Node.js image.
#
# IMPORTANT: node-screenshots captures Win32 windows and cannot work inside a
# Linux container. Run this image only if you are deploying the app on a
# Windows host using Windows containers, OR if you want to run the dashboard
# without the OCR capture (e.g. graph-only viewing mode on a separate host).
#
# For the standard Windows workflow, build locally and run directly:
#   npm run build && node dist/index.js
#
# DB credentials are supplied exclusively via environment variables.
# Copy .env.example → .env and fill in your values before running.

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-slim AS production
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Static assets are part of the source — copy them alongside compiled JS
COPY src/server/static ./dist/server/static

# Create the config data directory (bind-mounted from host at runtime)
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV CONFIG_DIR=/app/data
EXPOSE 3000

# /app/data is bind-mounted from the host as a directory — config.json lives inside.
# DB credentials come from environment variables — never baked into the image.
CMD ["node", "dist/index.js"]
