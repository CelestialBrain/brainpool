// ─── SQLite Connection ────────────────────────────────────────────────────────
// Lazy singleton. Applies WAL mode and runs migrations on first access.

import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { createLogger } from './logger.js';

const log = createLogger('db');

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

function runMigrations(db: Database.Database): void {
  const migrationsDir = join(__dirname, '../../migrations');

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        db.exec(stmt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('duplicate column')) {
          log.debug(`Skipping duplicate column in ${file}: ${msg}`);
        } else {
          throw err;
        }
      }
    }

    log.info(`Migration applied: ${file}`);
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(config.dbPath);

  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');

  runMigrations(_db);

  log.info('Database initialized', { path: config.dbPath });
  return _db;
}
