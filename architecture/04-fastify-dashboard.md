# Architecture: Fastify Dashboard

## Overview

The Fastify server exposes both the API and the static HTML dashboard. It runs in the main process. No authentication. Port is configurable via `PORT` environment variable (default: 3000).

---

## Server Setup (`src/server/server.ts`)

```typescript
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';

export function buildServer(sessionManager: SessionManager, config: AppConfig) {
  const app = Fastify({
    logger: {
      level: 'info',
      transport: { target: 'pino-pretty' }
    }
  });

  // Static files (HTML, JS, CSS)
  app.register(fastifyStatic, {
    root: path.join(__dirname, '../static'),
    prefix: '/static/',
  });

  // Register route groups
  app.register(dashboardRoutes, { prefix: '/' });
  app.register(gamesRoutes,     { prefix: '/api/games' });
  app.register(sessionRoutes,   { prefix: '/api/session' });
  app.register(configRoutes,    { prefix: '/api/config' });
  app.register(graphRoutes,     { prefix: '/graph' });
  app.register(graphDataRoutes, { prefix: '/api/graph' });

  return app;
}
```

---

## Route Specifications

### Dashboard Routes (`src/server/routes/dashboard.ts`)

```
GET /
  → Serves dashboard.html (static)
  → The HTML loads dashboard state via JS polling /api/session/status

GET /recent
  → Serves recentgames.html (static)
  → JS fetches /api/games?page=1
```

### Games Routes (`src/server/routes/games.ts`)

```
GET /api/games?page=1&perPage=20
  Response: {
    games: [{ uuid, name, description, created_at }],
    total: number,
    page: number,
    perPage: number,
    totalPages: number
  }

POST /api/games
  Body: { name?: string, description?: string }
  Validation (zod):
    name: z.string().max(255).optional()
    description: z.string().optional()
  Response: { uuid: string, created_at: string }
  Side effect: inserts into lol_games

GET /api/games/:uuid
  Response: { uuid, name, description, created_at } | 404
```

### Session Routes (`src/server/routes/session.ts`)

```
GET /api/session/status
  Response: {
    state: 'IDLE' | 'RUNNING',
    activeGameUUID: string | null,
    consecutiveFails: number,
    autoStart: boolean,
    autoStop: boolean,
    processName: string
  }

POST /api/session/start
  Body: { gameUUID: string }
  Validation: gameUUID must exist in lol_games
  Side effect: sessionManager.start(gameUUID)
  Response: { ok: true }
  Error: 409 if already RUNNING

POST /api/session/stop
  Side effect: sessionManager.stop()
  Response: { ok: true }

POST /api/session/select
  Body: { gameUUID: string | null }
  Side effect: updates config.activeGameUUID, saves config
  Response: { ok: true }
```

### Config Routes (`src/server/routes/session.ts`)

```
GET /api/config
  Response: full config object (passwords redacted)

POST /api/config
  Body (partial, all optional):
    {
      processName?: string,
      autoStart?: boolean,
      autoStop?: boolean,
      regions?: {
        blueGold?: { x, y, width, height },
        redGold?:  { x, y, width, height }
      },
      db?: { host, port, user, password, database }
    }
  Validation: zod schema
  Side effect: merges into config, saves config.json
  Response: { ok: true }
  Note: DB config changes require restart to take effect
```

### Graph Routes (`src/server/routes/graph.ts`)

```
GET /graph/:gameUUID
  → Serves graph.html with gameUUID injected as a data attribute
  → <div id="app" data-game-uuid="<uuid>" data-smooth="<0|1>">
  → smooth determined by ?smooth=1 query param

GET /api/graph/:gameUUID/data
  Response: {
    gameUUID: string,
    gameName: string | null,
    active: boolean,           ← true if this UUID is currently active in session
    startTime: string | null,  ← ISO timestamp of first reading
    readings: [
      { t: number, blueGold: number, redGold: number, diff: number }
      // t = seconds since startTime
      // diff = blueGold - redGold (in k units, multiply by 1000 for display)
    ]
  }

GET /api/graph/:gameUUID/export
  → PNG image response (Content-Type: image/png)
  → Renders via chartjs-node-canvas
  → Accepts ?smooth=1 query param
  → Returns 404 if gameUUID not found
  → Returns 204 with body "No data" if no readings
```

---

## Dashboard HTML/JS Design (`src/server/static/dashboard.html`)

### Layout

```
┌─────────────────────────────────────────────────────┐
│  lol-gold Dashboard                    [status: ●]  │
├─────────────────────────────────────────────────────┤
│  Game Session                                        │
│  ┌────────────────────────────┐  [New Game]         │
│  │ Select Game UUID ▼         │  [Apply]            │
│  └────────────────────────────┘                     │
│                                                      │
│  OCR Control                                         │
│  [Start OCR]  [Stop OCR]                            │
│  [✓] Auto Start    [✓] Auto Stop                    │
│                                                      │
│  Capture Settings                                    │
│  Process Name: [League Of Legends (TM)        ]     │
│                                                      │
│  Blue Gold Region: x[798] y[17] w[60] h[20]         │
│  Red Gold Region:  x[1103] y[18] w[60] h[20]        │
│  [Save Settings]                                     │
│                                                      │
│  [View Recent Games →]                              │
└─────────────────────────────────────────────────────┘
```

### Status Indicator

The `[status: ●]` indicator in the top right:
- Green dot = RUNNING
- Grey dot = IDLE
- Red dot = Worker crashed

Polled every 2 seconds via `GET /api/session/status`.

### New Game Modal

Clicking [New Game] opens an inline modal:
```
┌─────────────────────────────────┐
│  Create New Game                │
│  Name:        [               ] │
│  Description: [               ] │
│  [Cancel]  [Create]             │
└─────────────────────────────────┘
```

On [Create]: POST /api/games → response UUID → auto-populates the game selector dropdown → does NOT auto-apply (user must click [Apply]).

### Game Selector Dropdown

Populated by `GET /api/games?page=1&perPage=100` on page load and after game creation. Displays `name (uuid)` or just `uuid` if no name.

### Auto Start / Auto Stop Toggles

Checkboxes. On change: `POST /api/config { autoStart: bool }` or `{ autoStop: bool }`.

---

## Recent Games Page (`src/server/static/recentgames.html`)

### Layout

```
┌─────────────────────────────────────────────────────┐
│  ← Dashboard    Recent Games                        │
├─────────────────────────────────────────────────────┤
│  Game Name          UUID              Created       │
│  ─────────────────────────────────────────────────  │
│  Team Fight         550e8400-...      2025-01-15    │
│  (unnamed)          6ba7b810-...      2025-01-14    │
│  Finals Scrim       6ba7b811-...      2025-01-13    │
│  ...                                                 │
├─────────────────────────────────────────────────────┤
│              [< Prev]  Page 1 / 5  [Next >]         │
└─────────────────────────────────────────────────────┘
```

Each row is a link to `/graph/<uuid>`. Pagination: 20 per page, buttons fetch `?page=N`.

---

## Error Response Format

All API errors return:
```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE",
  "statusCode": 400
}
```

Common error codes:
- `GAME_NOT_FOUND` — UUID does not exist in lol_games
- `SESSION_ALREADY_RUNNING` — start called while RUNNING
- `SESSION_NOT_RUNNING` — stop called while IDLE
- `NO_GAME_SELECTED` — start called without activeGameUUID
- `VALIDATION_ERROR` — request body failed zod validation
- `DB_ERROR` — database query failed

---

## Server-Sent Events for Dashboard Push

The dashboard uses SSE for real-time state pushes (avoiding polling lag for auto-stop/start events):

```
GET /api/session/events
  Content-Type: text/event-stream

  Events emitted:
    data: { type: 'stateChange', state: 'IDLE' | 'RUNNING' }
    data: { type: 'autoStopped', gameUUID: string }
    data: { type: 'autoStarted', gameUUID: string }
    data: { type: 'workerCrash', error: string }
```

```typescript
// In session route handler:
app.get('/api/session/events', (req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (data: object) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sessionManager.on('session:stateChange', (e) => send({ type: 'stateChange', ...e }));
  sessionManager.on('session:autoStopped', (e) => send({ type: 'autoStopped', ...e }));

  req.raw.on('close', () => {
    sessionManager.removeAllListeners('session:stateChange');
    // cleanup...
  });
});
```

**Note**: Only one SSE connection expected (single browser tab). No connection pooling needed.
