import { randomUUID } from 'crypto';
import { getDb } from './connection';

export interface GameRow {
  uuid:        string;
  name:        string | null;
  description: string | null;
  /** ISO 8601 timestamp. */
  created_at:  string;
}

export interface GraphRow {
  /** Team gold in thousands. */
  blue_gold:   number;
  red_gold:    number;
  recorded_at: Date;
}

export interface ListGamesResult {
  games:      GameRow[];
  total:      number;
  page:       number;
  perPage:    number;
  totalPages: number;
}

export async function createGame(name?: string, description?: string): Promise<string> {
  const uuid = randomUUID();
  getDb()
    .prepare('INSERT INTO lol_games (uuid, name, description, created_at) VALUES (?, ?, ?, ?)')
    .run(uuid, name ?? null, description ?? null, new Date().toISOString());
  return uuid;
}

export async function listGames(page: number, perPage = 20): Promise<ListGamesResult> {
  const db     = getDb();
  const offset = (page - 1) * perPage;
  const games  = db
    .prepare('SELECT uuid, name, description, created_at FROM lol_games ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(perPage, offset) as unknown as GameRow[];
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM lol_games').get() as { total: number };
  return { games, total, page, perPage, totalPages: Math.ceil(total / perPage) };
}

export async function getGame(uuid: string): Promise<GameRow | null> {
  const row = getDb()
    .prepare('SELECT uuid, name, description, created_at FROM lol_games WHERE uuid = ?')
    .get(uuid);
  return (row as unknown as GameRow | undefined) ?? null;
}

export function insertReading(
  gameUuid:   string,
  blueGold:   number,
  redGold:    number,
  recordedAt: Date
): void {
  try {
    getDb()
      .prepare('INSERT INTO lol_team_score_graph (game_uuid, blue_gold, red_gold, recorded_at) VALUES (?, ?, ?, ?)')
      .run(gameUuid, blueGold, redGold, recordedAt.getTime());
  } catch (err) {
    console.error('[DB] Insert failed:', (err as Error).message);
  }
}

export async function getGraphData(gameUuid: string): Promise<GraphRow[]> {
  const rows = getDb()
    .prepare(
      `SELECT blue_gold, red_gold, recorded_at
       FROM lol_team_score_graph
       WHERE game_uuid = ?
       ORDER BY recorded_at ASC`
    )
    .all(gameUuid) as unknown as { blue_gold: number; red_gold: number; recorded_at: number }[];
  return rows.map(r => ({ ...r, recorded_at: new Date(r.recorded_at) }));
}
