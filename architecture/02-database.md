# Architecture: Database

## Overview

MariaDB stores all game metadata and gold readings. The database name is `btg_temp`. Connection is handled via `mysql2` with a connection pool. All schema creation is handled by the app's migration runner at startup.

---

## Connection (`src/db/connection.ts`)

```typescript
import mysql from 'mysql2/promise';
import { AppConfig } from '../config/config';

let pool: mysql.Pool | null = null;

export function createPool(config: AppConfig): mysql.Pool {
  pool = mysql.createPool({
    host:               config.db.host,
    port:               config.db.port,
    user:               config.db.user,
    password:           config.db.password,
    database:           config.db.database,  // 'btg_temp'
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    enableKeepAlive:    true,
    keepAliveInitialDelay: 10000,
    // Reconnect is automatic with pool — lost connections are re-acquired
  });
  return pool;
}

export function getPool(): mysql.Pool {
  if (!pool) throw new Error('DB pool not initialized');
  return pool;
}
```

**Config fields**:
```json
{
  "db": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "lolgold",
    "password": "secret",
    "database": "btg_temp"
  }
}
```

**Connection loss handling**: `mysql2` pool automatically retries failed connections. In the OCR insert path, if the insert fails, the error is caught, logged, and the reading is silently dropped (fire-and-forget). A separate health check pings the DB every 30s and logs a warning if unreachable.

---

## Migrations (`src/db/migrations.ts`)

Run at startup before Fastify begins listening. Idempotent — uses `CREATE TABLE IF NOT EXISTS`.

```typescript
export async function runMigrations(pool: mysql.Pool): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS lol_games (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        uuid        CHAR(36)     NOT NULL,
        name        VARCHAR(255) NULL,
        description TEXT         NULL,
        created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_uuid (uuid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS lol_team_score_graph (
        id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        game_uuid   CHAR(36)      NOT NULL,
        blue_gold   DECIMAL(8,1)  NOT NULL,
        red_gold    DECIMAL(8,1)  NOT NULL,
        recorded_at DATETIME(3)   NOT NULL,
        INDEX idx_game_uuid_time (game_uuid, recorded_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}
```

---

## Schema Reference

### `lol_games`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INT UNSIGNED AUTO_INCREMENT | Internal PK |
| `uuid` | CHAR(36) | UUID v4, unique |
| `name` | VARCHAR(255) NULL | User-provided, optional |
| `description` | TEXT NULL | User-provided, optional |
| `created_at` | DATETIME(3) | Millisecond precision, set by DB |

**Ordering for recent games**: `ORDER BY created_at DESC` — creation date is the canonical sort key.

### `lol_team_score_graph`

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | Internal PK |
| `game_uuid` | CHAR(36) | FK to `lol_games.uuid` (no FK constraint — avoids lock overhead) |
| `blue_gold` | DECIMAL(8,1) | e.g. `12.5` (represents 12.5k) |
| `red_gold` | DECIMAL(8,1) | e.g. `9.8` (represents 9.8k) |
| `recorded_at` | DATETIME(3) | Millisecond-precision timestamp from app |

**No foreign key constraint**: Avoids lock contention on `lol_games` during high-frequency inserts. Referential integrity is maintained by application logic.

**Index**: `(game_uuid, recorded_at)` covers all query patterns:
- Fetch all readings for a game ordered by time: `WHERE game_uuid = ? ORDER BY recorded_at`
- Fetch first reading (game start time): `WHERE game_uuid = ? ORDER BY recorded_at ASC LIMIT 1`

---

## Query Functions (`src/db/queries.ts`)

```typescript
import { getPool } from './connection';
import { v4 as uuidv4 } from 'uuid';

// --- Games ---

export async function createGame(name?: string, description?: string) {
  const uuid = uuidv4();
  await getPool().query(
    'INSERT INTO lol_games (uuid, name, description) VALUES (?, ?, ?)',
    [uuid, name ?? null, description ?? null]
  );
  return uuid;
}

export async function listGames(page: number, perPage = 20) {
  const offset = (page - 1) * perPage;
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT uuid, name, description, created_at FROM lol_games ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [perPage, offset]
  );
  const [[{ total }]] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) as total FROM lol_games'
  );
  return { games: rows, total: total as number, page, perPage };
}

export async function getGame(uuid: string) {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT * FROM lol_games WHERE uuid = ?',
    [uuid]
  );
  return rows[0] ?? null;
}

// --- Readings ---

export async function insertReading(
  gameUuid: string,
  blueGold: number,
  redGold: number,
  recordedAt: Date
): Promise<void> {
  // Fire-and-forget in OCR path — caller does not await
  getPool().query(
    'INSERT INTO lol_team_score_graph (game_uuid, blue_gold, red_gold, recorded_at) VALUES (?, ?, ?, ?)',
    [gameUuid, blueGold, redGold, recordedAt]
  ).catch(err => {
    console.error('[DB] Insert failed:', err.message);
  });
}

export async function getGraphData(gameUuid: string): Promise<GraphRow[]> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    `SELECT blue_gold, red_gold, recorded_at
     FROM lol_team_score_graph
     WHERE game_uuid = ?
     ORDER BY recorded_at ASC`,
    [gameUuid]
  );
  return rows as GraphRow[];
}

export interface GraphRow {
  blue_gold: string;   // DECIMAL comes back as string from mysql2
  red_gold: string;
  recorded_at: Date;
}
```

---

## Data Volume Estimates

| Scenario | Rows | Size |
|----------|------|------|
| 1 game × 2h | 7,200 | ~500KB |
| 100 games | 720,000 | ~50MB |
| 1000 games | 7,200,000 | ~500MB |

MariaDB handles this volume trivially. The composite index ensures graph queries remain fast even at millions of rows.

---

## Backup / Retention

- `btg_temp` is a persistent database (despite the "temp" name)
- No automatic row pruning — data is retained indefinitely
- Production backup: standard MariaDB `mysqldump` via cron outside app scope
