import type { DatabaseSync } from 'node:sqlite';

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lol_games (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid        TEXT NOT NULL UNIQUE,
      name        TEXT,
      description TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lol_team_score_graph (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      game_uuid   TEXT    NOT NULL,
      blue_gold   REAL    NOT NULL,
      red_gold    REAL    NOT NULL,
      recorded_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_game_uuid_time
      ON lol_team_score_graph (game_uuid, recorded_at);
  `);
  console.log('[DB] Migrations complete');
}
