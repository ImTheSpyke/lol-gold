# lol-graph

TypeScript/Node app that OCRs League of Legends team gold totals at 1Hz,
stores them in SQLite, and serves a Fastify dashboard with live graphs.
See `README.md` for setup, scripts, routes and API.

## Commands

- `npm run dev`: run from source (ts-node-dev; the OCR worker loads via `ts-node/register`)
- `npm run typecheck`: checks `src/` and `tests/` (`tsconfig.json`, no emit)
- `npm test`: Jest via ts-jest
- `npm run build`: emits `dist/` from `src/` only (`tsconfig.build.json`)

## Architecture

```
main thread                                   OCR worker thread (src/ocr/worker.ts)
  index.ts ── loadConfig, DB pool, migrations    every ~1s:
  SessionManager (src/session/manager.ts)          capture.ts    node-screenshots window grab (Windows only)
    ├─ spawns/supervises worker  ◄── messages ──   preprocess.ts crop → channel filter → pad → 4x upscale PNG
    ├─ IDLE/RUNNING state, auto start/stop         PaddleOCR     ppu-paddle-ocr recognizer (ESM, loaded via esmImport)
    └─ insertReading (fire-and-forget)              parse.ts      /(\d+[.,]\d+)k/ → value ≤ 200
  buildServer (src/server/server.ts)
```

- Worker ↔ main protocol is typed in `src/ocr/messages.ts`. The worker loops until terminated.
- If the worker exits non-zero, `SessionManager` respawns it after 2s. `close()` disables respawn.
- `SessionManager` rejects readings that jump ≥10k from the previous one (OCR misreads).
- Auto-stop: 5 consecutive failed reads while RUNNING with `autoStop` on. This also deselects the game.
- Auto-start: a valid reading while IDLE with `autoStart` on and a game selected.

## Conventions

- **Config**: `config.json` in `CONFIG_DIR` (default cwd) is validated by the zod schema in `src/config/config.ts`.
  The SQLite file is `lol-graph.db` in `CONFIG_DIR`, or `DB_PATH` if set.
- **Errors**: routes reply with `sendError(reply, status, code, message)` from `src/server/errors.ts`,
  which produces `{ error, code, statusCode }`.
- **Static pages** live in `public/`, served at `/static/*`. HTML pages are rendered by
  `src/server/routes/pages.ts` with `{{KEY}}` placeholder substitution. Validate anything
  injected (e.g. UUID params).
- Chart.js for the browser is served from `node_modules` at `/vendor/chart.js/`. Do not vendor it.
- **Smoothing** is a Gaussian moving average (window 15, σ=5). `src/graph/smoothing.ts` (PNG export)
  and `public/smoothing.js` (browser) must stay in sync.
- Gold values are in thousands (`12.5k` → `12.5`), stored as `REAL`.

## Database (SQLite via built-in `node:sqlite`, created by `src/db/migrations.ts`)

- `lol_games(id, uuid UNIQUE, name, description, created_at)` (`created_at` is ISO text)
- `lol_team_score_graph(id, game_uuid, blue_gold, red_gold, recorded_at)` (`recorded_at` is epoch ms), indexed on `(game_uuid, recorded_at)`

## Deployment notes

`node-screenshots` needs the Win32 desktop, so the app only does live OCR when run directly on Windows.
