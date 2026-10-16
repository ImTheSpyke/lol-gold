import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

let db: DatabaseSync | null = null;

/** Opens (creating if needed) the SQLite database file and enables WAL. */
export function openDatabase(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}

export function pingDB(): boolean {
  try {
    getDb().prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}
