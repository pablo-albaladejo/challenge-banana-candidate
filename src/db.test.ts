import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appDb, closeAppDb } from './db';
const tables = () =>
  (
    appDb().prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
describe('appDb', () => {
  afterEach(() => appDb().exec("DELETE FROM meta WHERE key='db-test'"));
  it('should create the application schema on first use', () => {
    // Arrange
    // Act
    const names = tables();
    // Assert
    for (const table of [
      'meta',
      'conversations',
      'messages',
      'runs',
      'intents',
      'approvals',
      'incidents',
      'events',
      'chunks',
      'embedding_cache',
    ])
      assert.ok(names.includes(table), `missing table ${table}`);
  });
  it('should return the same connection on repeated calls', () => {
    // Arrange
    const first = appDb();
    // Act
    const second = appDb();
    // Assert
    assert.equal(second, first);
  });
  it('should enable WAL journaling and foreign keys', () => {
    // Arrange
    const db = appDb();
    // Act
    const journal = db.pragma('journal_mode', { simple: true });
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    // Assert
    assert.equal(journal, 'wal');
    assert.equal(foreignKeys, 1);
  });
  it('should keep existing data when the schema is created again after reopening', () => {
    // Arrange
    appDb().prepare('INSERT INTO meta VALUES(?,?)').run('db-test', 'kept');
    const before = tables();
    closeAppDb();
    // Act
    const db = appDb();
    // Assert
    assert.deepEqual(tables(), before);
    assert.deepEqual(db.prepare('SELECT value FROM meta WHERE key=?').get('db-test'), {
      value: 'kept',
    });
  });
});
