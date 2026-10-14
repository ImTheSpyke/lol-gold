import type mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { getPool } from './connection';

export interface GameRow {
  uuid:        string;
  name:        string | null;
  description: string | null;
  created_at:  Date;
}

export interface GraphRow {
  blue_gold:   string;
  red_gold:    string;
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
  await getPool().query(
    'INSERT INTO lol_games (uuid, name, description) VALUES (?, ?, ?)',
    [uuid, name ?? null, description ?? null]
  );
  return uuid;
}

export async function listGames(page: number, perPage = 20): Promise<ListGamesResult> {
  const offset = (page - 1) * perPage;
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT uuid, name, description, created_at FROM lol_games ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [perPage, offset]
  );
  const [[countRow]] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) as total FROM lol_games'
  );
  const total = countRow['total'] as number;
  return {
    games:      rows as GameRow[],
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  };
}

export async function getGame(uuid: string): Promise<GameRow | null> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT uuid, name, description, created_at FROM lol_games WHERE uuid = ?',
    [uuid]
  );
  return (rows[0] as GameRow) ?? null;
}

export function insertReading(
  gameUuid:   string,
  blueGold:   number,
  redGold:    number,
  recordedAt: Date
): void {
  getPool()
    .query(
      'INSERT INTO lol_team_score_graph (game_uuid, blue_gold, red_gold, recorded_at) VALUES (?, ?, ?, ?)',
      [gameUuid, blueGold, redGold, recordedAt]
    )
    .catch((err: Error) => {
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
