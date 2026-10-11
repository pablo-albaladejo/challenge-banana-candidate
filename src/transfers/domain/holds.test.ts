import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { heldBy } from './holds';

const intentId = 'intent-asking';

describe('heldBy', () => {
  it('should hold nothing without a pending twin', () => {
    // Arrange
    const twins: { id: string }[] = [];
    // Act
    const held = heldBy(twins, intentId, undefined);
    // Assert
    assert.equal(held, null);
  });

  it('should hold by the newest twin with the exact review message', () => {
    // Arrange
    const twins = [{ id: 'intent-newest' }, { id: 'intent-older' }];
    // Act
    const held = heldBy(twins, intentId, undefined);
    // Assert
    assert.deepEqual(held, {
      status: 'requires_review',
      pendingIntentId: 'intent-newest',
      intentId,
      error: 'A matching transfer is still being verified with the bank.',
    });
  });

  it('should release the hold when the override names the newest twin', () => {
    // Arrange
    const twins = [{ id: 'intent-newest' }, { id: 'intent-older' }];
    // Act
    const held = heldBy(twins, intentId, 'intent-newest');
    // Assert
    assert.equal(held, null);
  });

  it('should keep the hold when the override names an older twin', () => {
    // Arrange
    const twins = [{ id: 'intent-newest' }, { id: 'intent-older' }];
    // Act
    const held = heldBy(twins, intentId, 'intent-older');
    // Assert
    assert.equal(held?.pendingIntentId, 'intent-newest');
  });
});
