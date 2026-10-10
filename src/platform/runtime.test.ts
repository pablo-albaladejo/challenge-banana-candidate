import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomIds, systemClock } from './runtime';

describe('systemClock', () => {
  it('should read the current time on every call', () => {
    // Arrange
    const before = Date.now();
    // Act
    const now = systemClock.now();
    // Assert
    assert.ok(now instanceof Date);
    assert.ok(now.getTime() >= before && now.getTime() <= Date.now());
  });
});

describe('randomIds', () => {
  it('should give a new random UUID on every call', () => {
    // Arrange
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    // Act
    const [first, second] = [randomIds.uuid(), randomIds.uuid()];
    // Assert
    assert.match(first, uuid);
    assert.match(second, uuid);
    assert.notEqual(first, second);
  });
});
