import mysql from 'mysql2/promise';
import type { DBConfig } from '../config/config';

let pool: mysql.Pool | null = null;

export function createPool(db: DBConfig): mysql.Pool {
  pool = mysql.createPool({
    host:                  db.host,
    port:                  db.port,
    user:                  db.user,
    password:              db.password,
    database:              db.database,
    waitForConnections:    true,
    connectionLimit:       10,
    queueLimit:            0,
    enableKeepAlive:       true,
    keepAliveInitialDelay: 10000,
  });
  return pool;
}

export function getPool(): mysql.Pool {
  if (!pool) throw new Error('DB pool not initialized');
  return pool;
}

export async function pingDB(): Promise<boolean> {
  try {
    const conn = await getPool().getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch {
    return false;
  }
}
