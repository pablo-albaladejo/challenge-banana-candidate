import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { migrate } from './migrations';
let instance: Database.Database | undefined;
export function appDb() {
  if (!instance) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    instance = new Database(path.join(config.dataDir, 'app.sqlite'));
    // Pragmas first: journal_mode cannot change inside the migrations' transactions.
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    instance.pragma('busy_timeout = 5000');
    migrate(instance);
  }
  return instance;
}
export function closeAppDb() {
  instance?.close();
  instance = undefined;
}
