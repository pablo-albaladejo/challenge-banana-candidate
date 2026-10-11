import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { approvalExpiresAt } from './approval';

describe('approvalExpiresAt', () => {
  it('should expire a proposal ten minutes after it is made', () => {
    // Arrange
    const now = new Date('2026-09-24T09:00:00.000Z');
    // Act
    const expiresAt = approvalExpiresAt(now);
    // Assert
    assert.equal(expiresAt, '2026-09-24T09:10:00.000Z');
  });
});
