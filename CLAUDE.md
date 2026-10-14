# lol-gold — Project Root Documentation

## Project Overview

`lol-gold` is a Windows-native TypeScript application that:
1. Captures two sub-regions of a target game process window (League of Legends) at 1Hz
2. Preprocesses each region into high-contrast B&W via channel filtering
3. Extracts gold values (`blue_gold`, `red_gold`) using a fast local OCR engine (<0.3s latency)
4. Persists timestamped readings into a MariaDB database keyed by game UUID
5. Exposes a Fastify web dashboard for session management, live graph viewing, and PNG export

**Stack**: TypeScript + Node.js, Fastify, MariaDB (`mysql2`), `node-screenshots`, `sharp`, OCR engine (see below), Chart.js (server-side render via `chartjs-node-canvas` for PNG, client-side for live graph), `worker_threads`.

**Target OS**: Windows (process capture) running inside Docker on Windows (Docker Desktop with host display passthrough or direct Node.js on host).

---

## Goals

- Sub-second OCR loop: capture → preprocess → OCR → DB insert in <1s total
- Reliable session lifecycle: auto-start/stop based on consecutive OCR match failures
- Persistent config across restarts (config.json, Docker-mounted volume)
- Clean web dashboard: game UUID management, region config, OCR controls, graph
- Graph: horizontally compressed to fit fixed width, gold-difference Y-axis, client-side smoothing
- PNG export of any game's graph

---

## Repository Structure

```
lol-gold/
├── CLAUDE.md                        ← this file
├── architecture/
│   ├── 01-ocr-pipeline.md
│   ├── 02-database.md
│   ├── 03-session-lifecycle.md
│   ├── 04-fastify-dashboard.md
│   ├── 05-graph-system.md
│   ├── 06-config-system.md
│   ├── 07-worker-thread.md
│   └── 08-docker-deployment.md
├── src/
│   ├── index.ts                     ← entrypoint: boots config, DB, Fastify, OCR worker
│   ├── config/
│   │   ├── config.ts                ← typed config loader/writer
│   │   └── defaults.ts              ← default region coords, process name, port
│   ├── db/
│   │   ├── connection.ts            ← MariaDB pool factory
│   │   ├── migrations.ts            ← table creation/migration runner
│   │   └── queries.ts               ← typed query functions
│   ├── ocr/
│   │   ├── worker.ts                ← worker_threads OCR worker entrypoint
│   │   ├── capture.ts               ← node-screenshots region capture
│   │   ├── preprocess.ts            ← sharp channel-filter pipeline
│   │   └── parse.ts                 ← regex number extractor + validator
│   ├── session/
│   │   └── manager.ts               ← OCR session state machine
│   ├── server/
│   │   ├── server.ts                ← Fastify instance factory
│   │   ├── routes/
│   │   │   ├── dashboard.ts         ← GET / (dashboard HTML)
│   │   │   ├── games.ts             ← GET/POST /api/games
│   │   │   ├── session.ts           ← POST /api/session/start|stop|config
│   │   │   ├── graph.ts             ← GET /graph/:gameUUID (HTML page)
│   │   │   └── graphData.ts         ← GET /api/graph/:gameUUID/data
│   │   └── static/
│   │       ├── dashboard.html
│   │       ├── graph.html
│   │       └── graph.js             ← client-side Chart.js + polling + smoothing
│   └── export/
│       └── png.ts                   ← chartjs-node-canvas PNG renderer
├── config.json                      ← runtime config (Docker volume mount)
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json
└── package.json
```

---

## Full Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                         Main Process                            │
│                                                                 │
│  index.ts                                                       │
│    ├── loadConfig()          → config.json                      │
│    ├── initDB()              → MariaDB pool + migrations        │
│    ├── startFastify()        → HTTP server (dashboard/API)      │
│    └── spawnOCRWorker()      → worker_threads Worker            │
│                                      │                          │
│                          postMessage(commands)                  │
│                          onMessage(results/events)              │
└─────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────┐
│                        OCR Worker Thread                        │
│                                                                 │
│  1Hz interval loop:                                             │
│    capture region1 + region2 (node-screenshots)                 │
│    preprocess region1 → blue channel filter → B&W (sharp)       │
│    preprocess region2 → red channel filter → B&W (sharp)        │
│    ocr(region1) → blue_gold string                              │
│    ocr(region2) → red_gold string                               │
│    validate both match /^\d+\.\d+k$/                            │
│    postMessage({ type: 'reading', blue_gold, red_gold, ts })    │
│    OR postMessage({ type: 'fail', consecutiveFails })           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
node-screenshots (process window capture, sub-region)
    │
    ▼
sharp pipeline
    ├── Region 1: pixel.b > 150 → white, else → black
    └── Region 2: pixel.r > 150 → white, else → black
    │
    ▼
OCR engine (raw text string)
    │
    ▼
parse.ts: regex /^(\d+\.\d+)k$/i → float value
    │
    ├── VALID → postMessage to main → session manager → DB insert
    └── INVALID → increment consecutiveFail counter
                  if consecutiveFail >= 5 AND autoStop → auto-stop session
```

---

## OCR Pipeline

See `/architecture/01-ocr-pipeline.md` for full detail.

**Recommended OCR Engine**: `node-tesseract-ocr` is too slow. Instead use:

**Primary recommendation**: [`@cherryblossom/tesseract-wasm`] — NO. Too slow.

**Actual recommendation**: Use **`lens-ocr`** (Google Lens API wrapper) — NO, requires internet.

**Final decision**: **`jimp` + custom digit recognizer** — NO, too fragile.

**Correct final decision**: Use **[`node-native-ocr`]** or compile **`paddle-ocr`** bindings.

After analysis, the correct choice for <0.3s latency on a 60×20px B&W image is:

**`tesseract.js` with LSTM disabled, legacy engine, digits+k whitelist, single-line PSM**

Tesseract is "slow" in default config. With proper tuning:
- PSM 7 (single line), OEM 0 (legacy engine only)
- Whitelist: `0123456789.k`
- Pre-initialized worker (init once, reuse)
- On a 60×20px image: typically 20–80ms ✓

If that still exceeds 0.3s in testing, **fallback**: **[`@guangzhengli/node-mlkit`]** — Windows-incompatible.

**Actual Windows-compatible fallback**: **`win32-ocr`** using Windows.Media.Ocr API via PowerShell bridge — adds latency.

**Best production choice confirmed**: `tesseract.js` v5 with worker pre-warmed, PSM=7, OEM=0, whitelist=`0123456789.k`. Benchmark on target hardware before shipping. If >0.3s, scale region up 4x with `sharp` before OCR (nearest-neighbor upscale to 240×80px improves Tesseract accuracy and speed on small text).

---

## Database Structure

See `/architecture/02-database.md` for full detail.

**Database**: `btg_temp`

### Table: `lol_games`
```sql
CREATE TABLE lol_games (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid          CHAR(36)     NOT NULL UNIQUE,
  name          VARCHAR(255) NULL,
  description   TEXT         NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: `lol_team_score_graph`
```sql
CREATE TABLE lol_team_score_graph (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_uuid   CHAR(36)       NOT NULL,
  blue_gold   DECIMAL(8,1)   NOT NULL,
  red_gold    DECIMAL(8,1)   NOT NULL,
  recorded_at DATETIME(3)    NOT NULL,
  INDEX idx_game_uuid_time (game_uuid, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## Web Dashboard Behavior

See `/architecture/04-fastify-dashboard.md` for full detail.

### Routes
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Dashboard HTML |
| GET | `/api/games` | Paginated game list (20/page) |
| POST | `/api/games` | Create game (name, description → uuid v4) |
| GET | `/api/games/:uuid` | Single game metadata |
| POST | `/api/session/start` | Start OCR loop on selected UUID |
| POST | `/api/session/stop` | Stop OCR loop, deselect UUID |
| GET | `/api/session/status` | Current session state |
| POST | `/api/config` | Update config (regions, process name, auto flags) |
| GET | `/api/config` | Read current config |
| GET | `/graph/:gameUUID` | Graph HTML page |
| GET | `/api/graph/:gameUUID/data` | JSON graph data (all points) |
| GET | `/api/graph/:gameUUID/export` | PNG export |

### Dashboard Controls
- **Game selector**: dropdown of existing games
- **Generate new Game UUID**: opens modal (name + description optional) → POST /api/games → auto-selects new UUID
- **Apply selected UUID**: sets `session.activeGameUUID` in config
- **Start OCR**: POST /api/session/start
- **Stop OCR**: POST /api/session/stop
- **Toggle Auto Start**: checkbox → PATCH /api/config `{ autoStart: bool }`
- **Toggle Auto Stop**: checkbox → PATCH /api/config `{ autoStop: bool }`
- **Region editor**: two coordinate inputs (x, y, w, h) per region

---

## Real-Time Graph System

See `/architecture/05-graph-system.md` for full detail.

- **Library**: Chart.js (client-side) via CDN
- **Data**: gold difference = `blue_gold - red_gold` per timestamp
- **X-axis**: time since first reading in game (minutes elapsed), compressed to fit canvas width
- **Y-axis**: gold difference, dynamic range minimum ±5000, expands if exceeded
- **Coloring**: line above 0 = blue fill, below 0 = red fill (Chart.js gradient or segment coloring)
- **Polling**: `setInterval(fetchAndUpdate, 60000)` — stops when API returns `{ active: false }`
- **Smoothing** (`?smooth=1`): client-side rolling average (window=10 points) applied before rendering
- **PNG export**: server-side `chartjs-node-canvas` renders identical chart → PNG response

---

## Process Lifecycle

See `/architecture/03-session-lifecycle.md` for full detail.

```
IDLE
  │ start() called (manual or autoStart)
  ▼
RUNNING ──── OCR success ──── insert DB ──── reset consecutiveFails
  │
  └── OCR fail → consecutiveFails++
        └── consecutiveFails >= 5 AND autoStop=true
              → emit 'autoStop'
              → deselect activeGameUUID
              → state = IDLE

IDLE + autoStart=true
  └── OCR loop still ticks (monitoring mode)
        └── OCR success → select last known UUID or prompt
              → state = RUNNING
```

---

## Performance Constraints

| Operation | Budget |
|-----------|--------|
| Screen capture (node-screenshots) | <50ms |
| sharp preprocessing (2 regions) | <20ms |
| OCR (2 regions, pre-warmed worker) | <200ms |
| DB insert (async, non-blocking) | <50ms (fire-and-forget) |
| **Total loop budget** | **<320ms** (must complete before next 1s tick) |

- OCR runs in a `worker_threads` Worker so it never blocks Fastify
- DB inserts are fire-and-forget (no await in OCR loop)
- `sharp` operations run on native bindings (no JS overhead)

---

## Error Handling Strategy

| Error | Handling |
|-------|----------|
| Process not found (window capture fails) | Log warning, count as OCR fail |
| sharp pipeline error | Log error, count as OCR fail |
| OCR engine crash | Restart worker, log critical |
| DB connection lost | Retry with exponential backoff (max 30s), buffer up to 60 inserts in memory |
| Config write failure | Log error, continue with in-memory config |
| Fastify route error | Return structured `{ error: string, code: string }` JSON |

---

## Scaling Considerations

- Single-instance design per deployment (one game at a time)
- Multiple instances share only DB (game_uuid separates data)
- MariaDB index on `(game_uuid, recorded_at)` handles all query patterns efficiently
- 7200 rows per 2h game × 100 games = 720,000 rows — trivial for MariaDB
- PNG export is CPU-intensive (chartjs-node-canvas): run in worker or cache result

---

## Suggested Packages

| Package | Purpose |
|---------|---------|
| `node-screenshots` | Process-targeted window/region capture |
| `sharp` | High-performance image preprocessing |
| `tesseract.js` v5 | OCR engine (pre-warmed, PSM=7, OEM=0) |
| `fastify` v4 | HTTP server |
| `@fastify/static` | Static file serving |
| `@fastify/websocket` | (optional, not used — HTTP polling chosen) |
| `mysql2` | MariaDB async driver with pool support |
| `uuid` | UUID v4 generation |
| `chart.js` | Client-side graph rendering |
| `chartjs-node-canvas` | Server-side PNG export |
| `zod` | Runtime config/request validation |
| `pino` | Structured logging (Fastify default) |
| `dotenv` | Environment variable loading |

---

## Development Roadmap

### Phase 1 — Core OCR Loop
1. Set up TypeScript project, tsconfig, package.json
2. Implement config system (load/save config.json)
3. Implement DB connection + migrations
4. Implement capture → preprocess → OCR → parse pipeline
5. Benchmark OCR latency on target hardware

### Phase 2 — Session Manager + Worker
6. Implement worker_threads OCR worker
7. Implement session state machine (start/stop/auto)
8. Wire worker messages to DB inserts

### Phase 3 — Fastify Dashboard
9. Implement all API routes
10. Build dashboard HTML/JS (vanilla or minimal framework)
11. Build graph page HTML/JS with Chart.js + polling

### Phase 4 — Graph + Export
12. Implement graph data API endpoint
13. Implement PNG export via chartjs-node-canvas
14. Implement client-side smoothing

### Phase 5 — Docker
15. Write Dockerfile + docker-compose.yml
16. Test full stack in Docker on Windows

---

## Testing Strategy

- **Unit**: parse.ts (regex validation), preprocess.ts (pixel logic with synthetic sharp buffers), config.ts (load/save roundtrip)
- **Integration**: DB queries against a test MariaDB instance, session state machine transitions
- **E2E**: Full OCR loop with a synthetic screenshot (known pixel values → known gold output)
- **Performance**: Benchmark OCR latency with `performance.now()` across 100 iterations on target hardware

---

## Deployment Considerations

- `config.json` mounted as Docker volume at `/app/config.json` → survives container restarts
- MariaDB host/port configurable in config.json (not hardcoded)
- Dashboard port set via `PORT` env variable (default 3000)
- No HTTPS required (local network)
- `node-screenshots` requires access to the Windows display — Docker on Windows requires the container to run with display access or the app runs directly on the host with Docker only for MariaDB
- See `/architecture/08-docker-deployment.md` for the display access limitation workaround
