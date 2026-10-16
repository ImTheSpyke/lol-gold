# lol-graph

Real-time team gold tracker for League of Legends.

Once per second, lol-graph reads both teams' gold totals from the in-game scoreboard
using a local OCR model, saves them in a SQLite file, and shows a live gold-difference
graph in your browser. It also exports PNGs and has overlay widgets for streaming.

![Gold difference graph of a sample game](docs/graph.png)

*Blue above the zero line means the blue team is ahead, red below means red is ahead.*

## Requirements

- **Windows** (screen capture needs the Windows desktop)
- **Node.js 26 or newer** (check with `node -v`)

## Getting started

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>. No database server and no other setup are needed:
the SQLite database is created automatically as `lol-graph.db` in the project folder.

## How to use

1. On the dashboard, create a game (or pick an existing one).
2. Choose the League of Legends window. If no gold is read, adjust the two capture
   regions so they sit exactly on the gold counters.
3. Click **Start OCR**. Or turn on **Auto Start** to record as soon as gold is detected;
   **Auto Stop** ends the session when reads keep failing (e.g. when the game ends).
4. Open the game's graph from the dashboard, or use the pages below.

| Page | What it is |
| --- | --- |
| `/` | Dashboard: games, controls, capture settings |
| `/recent` | Recent games |
| `/graph/<game-id>` | Live graph (add `?smooth=1` to smooth it) |
| `/widget/<game-id>` | Graph without page chrome, for stream overlays |
| `/widget/current` | Overlay that follows whichever game is being recorded |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run with auto-reload |
| `npm run build` then `npm start` | Build and run the compiled app |
| `npm test` | Run the tests |
| `npm run typecheck` | Check the TypeScript types |

## Settings (optional)

Everything has a default. To change something, copy `.env.example` to `.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Dashboard port |
| `CONFIG_DIR` | project folder | Where `config.json` and the database are stored |
| `DB_PATH` | `<CONFIG_DIR>/lol-graph.db` | SQLite file location |

Window name, capture regions and the auto toggles are saved in `config.json`
(created on first run) and edited from the dashboard.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Error during `npm install` or start | Install Node.js 26 or newer. |
| League window not in the list | Open the game, then refresh the list. |
| No gold values are read | Adjust the capture regions on the dashboard. |
| Port 3000 already in use | Set another `PORT` in `.env`. |

## For developers

```
src/
  index.ts      entry point
  config/       config.json schema and loading
  db/           SQLite connection, tables, queries
  ocr/          worker thread: capture, preprocess, OCR, parse
  session/      start/stop logic and worker supervision
  graph/        data transform, smoothing, PNG export
  server/       Fastify server and routes (the HTTP API lives here)
public/         dashboard, graph and widget pages
tests/          Jest tests
```

## License

[MIT](LICENSE)
