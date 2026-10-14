# lol-gold

Real-time team gold tracker for League of Legends.

lol-gold captures the in-game scoreboard once per second, reads both teams' gold
totals with a local OCR model (PaddleOCR), stores the readings in MariaDB, and
serves a web dashboard with a live gold-difference graph, PNG export, and
streaming-overlay widgets.

## Requirements

- **Node.js ≥ 20** on **Windows**. Screen capture (`node-screenshots`) needs the Win32 desktop.
- **MariaDB** (local via Docker Compose, or any reachable instance).

## Quick start

```bash
npm install
cp .env.example .env        # then edit the DB_* values
npm run db:up               # optional: local MariaDB in Docker
npm run dev                 # http://localhost:3000
```

Tables are created automatically on startup.

## Scripts

| Script                 | Description                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run dev`          | Run from source with auto-reload                                  |
| `npm run build`        | Compile TypeScript to `dist/`                                     |
| `npm start`            | Run the compiled app                                              |
| `npm test`             | Run the Jest test suite                                           |
| `npm run typecheck`    | Type-check sources and tests                                      |
| `npm run db:up` / `db:down` | Start / stop the local MariaDB container                     |
| `npm run docker:build` | Build the image `harbor.imthespyke.fr/imthespyke/lol-graph:latest` |
| `npm run docker:push`  | Push that image to Harbor (run `docker login harbor.imthespyke.fr` first) |
| `npm run docker:up` / `docker:down` / `docker:logs` | Manage the Compose stack            |

## Configuration

**Environment** (`.env`):

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Dashboard port |
| `CONFIG_DIR` | working directory | Directory containing `config.json` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `127.0.0.1`, `3306`, `root`, *(empty)*, `btg_temp` | MariaDB connection |

**Runtime settings** (`config.json`, created on first run and editable from the
dashboard): target window name, capture regions for each team's gold counter,
the selected game, and the auto-start / auto-stop toggles.

## Usage

1. Open the dashboard at `/` and create a game (or select an existing one).
2. Pick the League of Legends window and adjust the two capture regions if needed.
3. Click **Start OCR**, or enable **Auto Start** to begin recording as soon as
   gold values are detected. **Auto Stop** ends the session after 5 consecutive
   failed reads (e.g. when the game ends).

| Page | Description |
| --- | --- |
| `/` | Dashboard: games, session controls, capture settings |
| `/recent` | Recent games list |
| `/graph/:uuid` | Live gold-difference graph (`?smooth=1` for Gaussian smoothing) |
| `/widget/:uuid` | Chrome-less graph for stream overlays |
| `/widget/current` | Overlay that follows whichever game is active |

### API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/games?page=&perPage=` | Paginated game list |
| `POST` | `/api/games` | Create a game `{ name?, description? }` |
| `GET` | `/api/games/:uuid` | Game metadata |
| `GET` | `/api/session/status` | Current session state |
| `POST` | `/api/session/start` | Start recording `{ gameUUID }` |
| `POST` | `/api/session/stop` | Stop recording |
| `POST` | `/api/session/select` | Select a game without starting `{ gameUUID \| null }` |
| `GET` | `/api/session/events` | Server-sent events for session changes |
| `GET` / `POST` | `/api/config` | Read / patch runtime settings |
| `GET` | `/api/config/processes` | Visible windows available for capture |
| `GET` | `/api/graph/:uuid/data` | Graph readings as JSON |
| `GET` | `/api/graph/:uuid/export?smooth=1` | Graph as a PNG |

Errors are returned as `{ error, code, statusCode }`.

## Docker

The image runs the dashboard and API. Because screen capture needs Windows,
OCR is disabled inside the Linux container, so use it to view or serve graphs.
For live capture, run the app directly on the Windows host and use Docker only
for MariaDB.

```bash
npm run docker:build
npm run docker:push
docker compose up -d                 # app only, external MariaDB
docker compose --profile db up -d    # app + local MariaDB
```

`./data` is mounted into the container so `config.json` survives restarts.

## Project layout

```
src/
  index.ts            entrypoint: config, DB, OCR worker, HTTP server
  config/             config.json schema + env-based DB config
  db/                 MariaDB pool, migrations, queries
  ocr/                worker thread: capture → preprocess → OCR → parse
  session/            session state machine, worker supervision, DB inserts
  graph/              reading transformation, smoothing, PNG export
  server/             Fastify server, routes, error helpers
public/               dashboard, graph and widget pages (static)
tests/                Jest unit tests
```
