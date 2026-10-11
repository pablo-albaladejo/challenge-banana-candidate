import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRANSITIONS, predecessorsOf } from './transitions';

describe('predecessorsOf', () => {
  it('should list created, requires_confirmation, unknown and failed as predecessors of requires_confirmation', () => {
    // Arrange
    const to = 'requires_confirmation';
    // Act
    const from = predecessorsOf(to);
    // Assert
    assert.deepEqual(from, ['created', 'requires_confirmation', 'unknown', 'failed']);
  });

  it('should list only requires_confirmation as the predecessor of processing', () => {
    // Arrange
    const to = 'processing';
    // Act
    const from = predecessorsOf(to);
    // Assert
    assert.deepEqual(from, ['requires_confirmation']);
  });

  it('should list processing, unknown and failed as predecessors of completed', () => {
    // Arrange
    const to = 'completed';
    // Act
    const from = predecessorsOf(to);
    // Assert
    assert.deepEqual(from, ['processing', 'unknown', 'failed']);
  });

  it('should list no predecessor for created', () => {
    // Arrange
    const to = 'created';
    // Act
    const from = predecessorsOf(to);
    // Assert
    assert.deepEqual(from, []);
  });
});

describe('TRANSITIONS', () => {
  it('should keep completed terminal', () => {
    // Arrange
    const from = 'completed';
    // Act
    const next = TRANSITIONS[from];
    // Assert
    assert.deepEqual(next, []);
  });
});
