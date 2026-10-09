import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seedApp } from './seed';
import { appDb } from './db';
import { allChunks } from './retrieval/store';
const count = (sql: string) => (appDb().prepare(sql).get() as { n: number }).n;
describe('seedApp', () => {
  it('should load the 47 seed conversations, each with messages', () => {
    // Arrange
    // Act
    seedApp();
    // Assert
    assert.equal(count('SELECT COUNT(*) n FROM conversations'), 47);
    assert.equal(
      count(
        'SELECT COUNT(*) n FROM conversations c WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id)',
      ),
      0,
    );
  });
  it('should load 17 support cases of which 8 are closed', () => {
    // Arrange
    // Act
    const result = seedApp();
    // Assert
    assert.equal(result.incidents, 17);
    assert.equal(count("SELECT COUNT(*) n FROM incidents WHERE status='closed'"), 8);
  });
  it('should restore the supplied index with 1536-dimension vectors', () => {
    // Arrange
    // Act
    const result = seedApp();
    // Assert
    const chunks = allChunks();
    assert.equal(result.indexLoaded, true);
    assert.ok(chunks.length > 300);
    assert.ok(chunks.every((c) => c.vector?.length === 1536));
  });
  it('should reproduce identical histories and index when run again', () => {
    // Arrange
    seedApp();
    const chunks = allChunks(),
      histories = appDb().prepare('SELECT * FROM conversations ORDER BY id').all(),
      messages = appDb().prepare('SELECT * FROM messages ORDER BY id').all();
    // Act
    seedApp();
    // Assert
    assert.deepEqual(allChunks(), chunks);
    assert.deepEqual(appDb().prepare('SELECT * FROM conversations ORDER BY id').all(), histories);
    assert.deepEqual(appDb().prepare('SELECT * FROM messages ORDER BY id').all(), messages);
  });
});
