import type mysql from 'mysql2/promise';

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

    console.log('[DB] Migrations complete');
  } finally {
    conn.release();
  }
}
