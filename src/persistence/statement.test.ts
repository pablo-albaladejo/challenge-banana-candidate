import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { statement } from './statement';
import { appDb, closeAppDb } from '../db';

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
