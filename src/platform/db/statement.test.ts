import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { atomically, statement } from './statement';
import { appDb, closeAppDb } from './db';

describe('statement', () => {
  it('should compile each SQL text once per connection', () => {
    // Arrange
    const sql = 'SELECT id FROM conversations WHERE id=?';
    // Act
    const first = statement(sql);
    const second = statement(sql);
    // Assert
    assert.equal(second, first);
    assert.equal(first.database, appDb());
  });
  it('should compile again for a new connection after the database is closed', () => {
    // Arrange
    const sql = 'SELECT id FROM runs WHERE id=?';
    const before = statement(sql);
    closeAppDb();
    // Act
    const after = statement(sql);
    // Assert
    assert.notEqual(after, before);
    assert.equal(after.database, appDb());
    assert.equal(after.get('missing'), undefined);
  });
});

describe('atomically', () => {
  const scratch = () => {
    appDb().exec('CREATE TEMP TABLE IF NOT EXISTS scratch(n INTEGER); DELETE FROM scratch');
    return () => appDb().prepare('SELECT COUNT(*) AS n FROM scratch').get() as { n: number };
  };
  it('should undo every write of the step when it throws', () => {
    // Arrange
    const rows = scratch();
    // Act & Assert
    assert.throws(
      () =>
        atomically(() => {
          statement('INSERT INTO scratch(n) VALUES(1)').run();
          throw new Error('step aborted');
        }),
      /step aborted/,
    );
    assert.equal(rows().n, 0);
  });
  it('should return the value of the step after committing it', () => {
    // Arrange
    const rows = scratch();
    // Act
    const changed = atomically(() => statement('INSERT INTO scratch(n) VALUES(1)').run().changes);
    // Assert
    assert.equal(changed, 1);
    assert.equal(rows().n, 1);
  });
});
