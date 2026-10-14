# Architecture: Docker Deployment

## Overview

The application is packaged as a Docker container. The TypeScript source is compiled to `dist/` via `tsc`. The container runs the compiled JS. `config.json` is bind-mounted from the host so settings persist across container recreation.

**Critical limitation**: `node-screenshots` captures windows from the host's Windows display. A Docker container on Windows (Docker Desktop with WSL2 backend) cannot access the host's Win32 window system by default. Two deployment strategies are provided:

1. **Recommended**: Run the Node.js app directly on the host (no container for the app), use Docker only for MariaDB.
2. **Alternative**: Run in a Windows container (Docker Desktop in Windows containers mode) which has host display access.

Both are documented below.

---

## Strategy 1 (Recommended): App on Host, DB in Docker

```
Host Windows Machine
├── Node.js app (direct, not containerized)
│     └── node dist/index.js
│           ├── captures LoL window directly (Win32)
│           └── connects to MariaDB at localhost:3306
└── Docker Desktop (Linux containers)
      └── mariadb container (port 3306 exposed to host)
```

### `docker-compose.yml` (DB only)

```yaml
version: '3.9'

services:
  mariadb:
    image: mariadb:11
    container_name: lol-gold-db
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:-rootpassword}
      MARIADB_DATABASE: btg_temp
      MARIADB_USER: ${DB_USER:-lolgold}
      MARIADB_PASSWORD: ${DB_PASSWORD:-lolgold}
    ports:
      - "3306:3306"
    volumes:
      - mariadb_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

volumes:
  mariadb_data:
    driver: local
```

### Running the app on host

```powershell
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Start DB
docker-compose up -d mariadb

# Run app
$env:PORT = "3000"
node dist/index.js
```

---

## Strategy 2: Full Docker (Windows Containers)

Requires Docker Desktop switched to "Windows containers" mode. Only works on Windows Server or Windows 10/11 Pro with Hyper-V.

### `Dockerfile`

```dockerfile
# Build stage
FROM node:20-windowsservercore-ltsc2022 AS builder
WORKDIR C:/app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ────────────────────────────────────────────────────────
FROM node:20-windowsservercore-ltsc2022 AS production
WORKDIR C:/app

# Copy compiled output and production deps
COPY --from=builder C:/app/dist ./dist
COPY --from=builder C:/app/node_modules ./node_modules
COPY package.json ./

# config.json will be bind-mounted at runtime
# If not mounted, app creates it with defaults on first run
VOLUME C:/app/config.json

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js"]
```

**Note**: Windows container images are very large (~5–15GB). This is a known trade-off.

---

## Strategy 2b: Linux Container with X11/Display (NOT recommended for production)

`node-screenshots` uses Win32 APIs and will not work in a Linux container. Do not attempt this.

---

## Primary `docker-compose.yml` (Full stack, Windows containers)

```yaml
version: '3.9'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: lol-gold-app
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:3000"
    environment:
      PORT: "${PORT:-3000}"
    volumes:
      # Bind-mount config.json so it persists on host
      - type: bind
        source: ./config.json
        target: C:/app/config.json
    depends_on:
      mariadb:
        condition: service_healthy
    # Windows containers have access to host display
    # No additional display configuration needed

  mariadb:
    image: mariadb:11
    container_name: lol-gold-db
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:-rootpassword}
      MARIADB_DATABASE: btg_temp
      MARIADB_USER: ${DB_USER:-lolgold}
      MARIADB_PASSWORD: ${DB_PASSWORD:-lolgold}
    ports:
      - "3306:3306"
    volumes:
      - mariadb_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

volumes:
  mariadb_data:
    driver: local
```

---

## `.env` File (for docker-compose)

```env
PORT=3000
DB_ROOT_PASSWORD=rootpassword
DB_USER=lolgold
DB_PASSWORD=lolgold
```

Never commit `.env` to version control. Add to `.gitignore`.

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## `package.json` Scripts

```json
{
  "name": "lol-gold",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "build":   "tsc --noEmit false",
    "dev":     "ts-node-dev --respawn --transpile-only src/index.ts",
    "start":   "node dist/index.js",
    "db:up":   "docker-compose up -d mariadb",
    "db:down": "docker-compose down",
    "docker:up":   "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f app"
  },
  "dependencies": {
    "fastify":               "^4.28.0",
    "@fastify/static":       "^7.0.0",
    "mysql2":                "^3.9.0",
    "node-screenshots":      "^0.1.10",
    "sharp":                 "^0.33.0",
    "tesseract.js":          "^5.1.0",
    "chart.js":              "^4.4.0",
    "chartjs-node-canvas":   "^4.1.6",
    "uuid":                  "^9.0.0",
    "zod":                   "^3.22.0",
    "dotenv":                "^16.4.0"
  },
  "devDependencies": {
    "typescript":          "^5.4.0",
    "@types/node":         "^20.0.0",
    "@types/uuid":         "^9.0.0",
    "ts-node-dev":         "^2.0.0"
  }
}
```

---

## First-Run Bootstrap

```powershell
# 1. Clone / download project
# 2. Install deps
npm install

# 3. Start MariaDB
docker-compose up -d mariadb

# 4. First run — creates config.json with defaults
node dist/index.js
# → open http://localhost:3000
# → configure DB credentials in dashboard
# → set process name if different from default
```

On first run, `loadConfig()` creates `config.json` with defaults. The user then opens the dashboard and adjusts DB credentials via the config panel. The app must be restarted after DB credential changes (documented in UI).

---

## Graceful Shutdown

```typescript
// src/index.ts
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function shutdown(signal: string) {
  console.log(`[Main] Received ${signal}, shutting down...`);
  await sessionManager.stop();
  worker.postMessage({ type: 'shutdown' });
  await app.close();
  await pool.end();
  process.exit(0);
}
```

`docker-compose down` sends SIGTERM → app shuts down cleanly → no orphaned Tesseract processes.

---

## `.dockerignore`

```
node_modules/
dist/
.env
config.json
*.md
.git/
```

`config.json` is excluded from the image — it is always bind-mounted at runtime.
