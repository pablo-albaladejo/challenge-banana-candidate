import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { faker } from '@faker-js/faker';
import { config } from './config';
import { migrate, migrations, type Migration } from './migrations';
import { customers } from '../tests/fixtures/world';

const opened: Database.Database[] = [];
/** A new database file in the test's temp DATA_DIR, configured like `appDb()` before it migrates. */
const open = (file = path.join(config.dataDir, `migrations-${randomUUID()}.sqlite`)) => {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  opened.push(db);
  return db;
};
const version = (db: Database.Database) => db.pragma('user_version', { simple: true }) as number;
const indexes = (db: Database.Database) =>
  (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((i) => i.name);
const tables = (db: Database.Database) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);

/** The schema `src/db.ts` created before migrations existed, with no `user_version`. */
const legacySchema = `
  CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,run_id TEXT);
  CREATE TABLE runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT,started_at TEXT NOT NULL,status TEXT NOT NULL,error TEXT);
  CREATE TABLE intents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT,run_id TEXT,payload TEXT NOT NULL,status TEXT NOT NULL,bank_reference TEXT,operation_id TEXT,error TEXT,created_at TEXT NOT NULL);
  CREATE TABLE approvals(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,intent_id TEXT NOT NULL,payload TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT);
  CREATE TABLE incidents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,summary TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE events(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT,kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE chunks(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,text TEXT NOT NULL,title TEXT,version INTEGER,valid_from TEXT,valid_to TEXT,audience TEXT NOT NULL,vector BLOB NOT NULL);
  CREATE TABLE embedding_cache(key TEXT PRIMARY KEY,vector BLOB NOT NULL);
`;

describe('migrate', () => {
  afterEach(() => {
    for (const db of opened.splice(0)) db.close();
  });
  it('should bring a fresh database to the latest version with the application schema', () => {
    // Arrange
    const db = open();
    // Act
    migrate(db);
    // Assert
    assert.equal(version(db), migrations.length);
    assert.deepEqual(tables(db), [
      'approvals',
      'chunks',
      'conversations',
      'embedding_cache',
      'events',
      'incidents',
      'intents',
      'messages',
      'meta',
      'runs',
    ]);
    assert.deepEqual(indexes(db), [
      'events_conversation',
      'incidents_user',
      'messages_conversation',
    ]);
  });
  it('should upgrade a database created before migrations without losing its rows', () => {
    // Arrange
    const db = open();
    db.exec(legacySchema);
    const conversationId = `conv-${faker.string.uuid()}`;
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO conversations(id,user_id,title,created_at) VALUES(?,?,?,?)').run(
      conversationId,
      customers.lucia,
      faker.lorem.words(3),
      createdAt,
    );
    db.prepare(
      'INSERT INTO messages(id,conversation_id,role,content,created_at,run_id) VALUES(?,?,?,?,?,?)',
    ).run(
      `message-${faker.string.uuid()}`,
      conversationId,
      'user',
      faker.lorem.sentence(),
      createdAt,
      null,
    );
    const before = {
      conversations: db.prepare('SELECT * FROM conversations').all(),
      messages: db.prepare('SELECT * FROM messages').all(),
    };
    // Act
    migrate(db);
    // Assert
    assert.equal(version(db), migrations.length);
    assert.deepEqual(db.prepare('SELECT * FROM conversations').all(), before.conversations);
    assert.deepEqual(db.prepare('SELECT * FROM messages').all(), before.messages);
  });
  it('should add the dispatch time to the intents of an upgraded database without losing them', () => {
    // Arrange
    const db = open();
    db.exec(legacySchema);
    db.prepare(
      'INSERT INTO intents(id,user_id,conversation_id,run_id,payload,status,bank_reference,operation_id,error,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ).run(
      `intent-${faker.string.uuid()}`,
      customers.lucia,
      null,
      null,
      '{}',
      'unknown',
      `ref-${faker.string.uuid()}`,
      null,
      faker.lorem.sentence(),
      new Date().toISOString(),
    );
    const before = db.prepare('SELECT * FROM intents').all() as Record<string, unknown>[];
    // Act
    migrate(db);
    // Assert
    assert.deepEqual(
      db.prepare('SELECT * FROM intents').all(),
      before.map((row) => ({ ...row, dispatched_at: null })),
    );
  });
  it('should leave an up-to-date database unchanged when it runs again', () => {
    // Arrange
    let runs = 0;
    const counted: Migration[] = [() => runs++];
    const db = open();
    migrate(db, counted);
    // Act
    migrate(db, counted);
    // Assert
    assert.equal(runs, 1);
    assert.equal(version(db), 1);
  });
  it('should roll back a failing migration and keep the previous version', () => {
    // Arrange
    const db = open();
    const failing: Migration[] = [
      (d) => d.exec('CREATE TABLE first_step(id TEXT)'),
      (d) => {
        d.exec('CREATE TABLE half_done(id TEXT)');
        throw new Error('migration failed');
      },
    ];
    // Act & Assert
    assert.throws(() => migrate(db, failing), /migration failed/);
    assert.equal(version(db), 1);
    assert.deepEqual(tables(db), ['first_step']);
  });
  it('should apply each migration once when two connections migrate the same file', () => {
    // Arrange
    let runs = 0;
    const counted: Migration[] = [(d) => (runs++, d.exec('CREATE TABLE once(id TEXT)'))];
    const file = path.join(config.dataDir, `migrations-${randomUUID()}.sqlite`);
    const first = open(file);
    const second = open(file);
    migrate(first, counted);
    // Act
    migrate(second, counted);
    // Assert
    assert.equal(runs, 1);
    assert.equal(version(second), 1);
  });
  it('should hold the write lock while a migration runs so another connection cannot migrate', () => {
    // Arrange
    const file = path.join(config.dataDir, `migrations-${randomUUID()}.sqlite`);
    const first = open(file);
    const second = open(file);
    second.pragma('busy_timeout = 0');
    let blocked: unknown;
    const probing: Migration[] = [
      (d) => {
        try {
          migrate(second, [(other) => other.exec('CREATE TABLE twice(id TEXT)')]);
        } catch (e) {
          blocked = e;
        }
        d.exec('CREATE TABLE once(id TEXT)');
      },
    ];
    // Act
    migrate(first, probing);
    // Assert
    assert.match(String((blocked as { code?: string })?.code), /SQLITE_BUSY/);
    assert.equal(version(second), 1);
    assert.deepEqual(tables(second), ['once']);
  });
});
