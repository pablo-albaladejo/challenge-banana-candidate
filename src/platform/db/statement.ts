import type Database from 'better-sqlite3';
import { appDb } from './db';
const compiled = new WeakMap<Database.Database, Map<string, Database.Statement>>();
/**
 * The prepared statement for `sql` on the current app connection, compiled once and reused: the
 * seed and the agent loop run the same few statements many times. A new connection (after
 * `closeAppDb`) gets its own statements.
 */
export function statement(sql: string): Database.Statement {
  const db = appDb();
  let cache = compiled.get(db);
  if (!cache) compiled.set(db, (cache = new Map()));
  let prepared = cache.get(sql);
  if (!prepared) cache.set(sql, (prepared = db.prepare(sql)));
  return prepared;
}
/**
 * Runs `step` as one `BEGIN IMMEDIATE` transaction on the app connection: it takes the write lock
 * before its first read, so no other writer can change what it reads before it writes. `step` must
 * be synchronous; if it throws, every write it made is rolled back and the error propagates.
 */
export function atomically<T>(step: () => T): T {
  return appDb().transaction(step).immediate();
}
