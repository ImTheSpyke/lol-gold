# Architecture: Config System

## Overview

All runtime configuration is stored in `config.json` in the project root. This file is persisted across restarts and is mounted as a Docker volume so changes survive container recreation. The config is loaded at startup, validated with Zod, and written back synchronously on any change.

---

## Config Schema

```typescript
// src/config/config.ts

import { z } from 'zod';

const RegionSchema = z.object({
  x:      z.number().int().min(0),
  y:      z.number().int().min(0),
  width:  z.number().int().min(1),
  height: z.number().int().min(1),
});

export const AppConfigSchema = z.object({
  processName:     z.string().default('League Of Legends'),
  activeGameUUID:  z.string().uuid().nullable().default(null),
  autoStart:       z.boolean().default(false),
  autoStop:        z.boolean().default(true),
  regions: z.object({
    blueGold: RegionSchema.default({ x: 798,  y: 17, width: 60, height: 20 }),
    redGold:  RegionSchema.default({ x: 1103, y: 18, width: 60, height: 20 }),
  }).default({}),
  db: z.object({
    host:     z.string().default('127.0.0.1'),
    port:     z.number().int().min(1).max(65535).default(3306),
    user:     z.string().default('root'),
    password: z.string().default(''),
    database: z.string().default('btg_temp'),
  }).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
```

---

## Default Config File

When `config.json` does not exist (first run), it is created with defaults:

```json
{
  "processName": "League Of Legends",
  "activeGameUUID": null,
  "autoStart": false,
  "autoStop": true,
  "regions": {
    "blueGold": { "x": 798,  "y": 17, "width": 60, "height": 20 },
    "redGold":  { "x": 1103, "y": 18, "width": 60, "height": 20 }
  },
  "db": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "",
    "database": "btg_temp"
  }
}
```

---

## Load / Save Implementation

```typescript
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = AppConfigSchema.parse({});
    saveConfig(defaults);
    return defaults;
  }

  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return AppConfigSchema.parse(raw); // validates + fills missing fields with defaults
}

export function saveConfig(config: AppConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function patchConfig(patch: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const merged = deepMerge(current, patch);
  const validated = AppConfigSchema.parse(merged);
  saveConfig(validated);
  return validated;
}
```

**Synchronous write**: Config changes are infrequent (user-initiated). Synchronous `writeFileSync` is acceptable and avoids race conditions without additional locking.

**Deep merge for nested objects**: When patching `regions.blueGold`, only the changed sub-fields are updated. The `deepMerge` helper performs a recursive merge (not a shallow `Object.assign`).

---

## Config Change Propagation

When config is updated via `POST /api/config`, the session manager must be notified so the OCR worker receives updated region coordinates and process name:

```typescript
// In config route handler:
const newConfig = patchConfig(req.body);
sessionManager.setConfig(newConfig);
// sessionManager.setConfig() calls:
//   this.config = newConfig
//   this.worker.postMessage({ type: 'updateConfig', config: newConfig })
```

The OCR worker receives the `updateConfig` message and updates its local region and process name references before the next tick.

**DB config changes**: Changes to `db.*` fields are saved to config.json but do NOT hot-reload the DB pool. A log warning is emitted: "DB config changed — restart required to reconnect." This is acceptable given the low frequency of DB reconfiguration.

---

## Environment Variables

Only one env variable is respected:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Fastify HTTP listen port |

All other config is in `config.json`. DB credentials are NOT read from env variables — they live in `config.json` (which is a Docker volume on the host, not baked into the image).

```typescript
// src/index.ts
const PORT = parseInt(process.env.PORT ?? '3000', 10);
```

---

## Docker Volume Mapping

In `docker-compose.yml`:
```yaml
volumes:
  - ./config.json:/app/config.json
```

This maps the host's `config.json` into the container. If the host file does not exist, Docker creates it as a directory (a known Docker gotcha). To prevent this:

```yaml
volumes:
  - type: bind
    source: ./config.json
    target: /app/config.json
```

The app must create `config.json` with defaults if it does not exist before Docker maps it. The correct workflow:

1. User runs `docker-compose up` for first time
2. App starts, `config.json` does not exist inside container
3. `loadConfig()` creates it with defaults
4. The volume bind makes it available on the host at `./config.json`
5. User edits `./config.json` on host if needed (or via dashboard)
6. On next `docker-compose up`, existing `./config.json` is used

**Note**: Because the bind mount replaces the file in the container, the creation in step 3 writes to the bound host path directly. This works correctly.

---

## Config Exposed to Dashboard

The `GET /api/config` endpoint returns the full config with password redacted:

```typescript
app.get('/api/config', async (req, reply) => {
  const config = loadConfig();
  const safe = {
    ...config,
    db: {
      ...config.db,
      password: config.db.password ? '***' : '',
    }
  };
  reply.send(safe);
});
```

The dashboard can display and edit all config fields. The password field shows `***` if set, empty if not. A blank password field in a POST /api/config request preserves the existing password (not overwritten with empty string):

```typescript
// In PATCH handler:
if (body.db?.password === '***' || body.db?.password === undefined) {
  delete body.db?.password; // don't overwrite
}
```
