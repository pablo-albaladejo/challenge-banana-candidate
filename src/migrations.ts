import type Database from 'better-sqlite3';
/** One schema step. Migration N brings the database from `user_version` N-1 to N. */
export type Migration = (db: Database.Database) => void;
/** Append only: never edit a migration that has shipped, add the next one. */
export const migrations: Migration[] = [
  // 1: the schema `src/db.ts` created before migrations existed, verbatim, so it is a no-op on
  // databases created by older code and they upgrade to version 1 without losing rows.
  (db) =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,run_id TEXT);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT,started_at TEXT NOT NULL,status TEXT NOT NULL,error TEXT);
      CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT,run_id TEXT,payload TEXT NOT NULL,status TEXT NOT NULL,bank_reference TEXT,operation_id TEXT,error TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,intent_id TEXT NOT NULL,payload TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT);
      CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,summary TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT,kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,text TEXT NOT NULL,title TEXT,version INTEGER,valid_from TEXT,valid_to TEXT,audience TEXT NOT NULL,vector BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS embedding_cache(key TEXT PRIMARY KEY,vector BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,created_at);
      CREATE INDEX IF NOT EXISTS incidents_user ON incidents(user_id);
      CREATE INDEX IF NOT EXISTS events_conversation ON events(conversation_id,created_at);
    `),
];
/**
 * Applies the pending migrations in order, each in its own IMMEDIATE transaction that re-reads
 * `user_version` inside the lock, so a concurrent connection that migrated first makes it a no-op
 * and a failing migration rolls back with the version unchanged. Set pragmas such as
 * `journal_mode` before calling: they cannot change inside a transaction.
 */
export function migrate(db: Database.Database, list: Migration[] = migrations) {
  list.forEach((migration, index) => {
    const target = index + 1;
    db.transaction(() => {
      if ((db.pragma('user_version', { simple: true }) as number) >= target) return;
      migration(db);
      db.pragma(`user_version = ${target}`);
    }).immediate();
  });
}
