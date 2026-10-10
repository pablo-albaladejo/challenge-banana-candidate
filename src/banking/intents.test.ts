import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { transition } from './intents';
import { persistIntent, intentRowOf } from '../../tests/fixtures/factories';
import { events, intentRow } from '../../tests/support/db';

describe('transition', () => {
  it('should write the status even when the edge is outside the table', () => {
    // Arrange
    const intent = persistIntent({ status: 'completed' });
    // Act
    transition(intent.id, 'processing');
    // Assert
    assert.equal(intentRow(intent.id)!.status, 'processing');
  });
  it('should report legal=false for completed→processing', () => {
    // Arrange
    const intent = persistIntent({ status: 'completed' });
    // Act
    const result = transition(intent.id, 'processing');
    // Assert
    assert.deepEqual(result, { changed: true, legal: false });
  });
  it('should report legal=true for requires_confirmation→processing', () => {
    // Arrange
    const intent = persistIntent({ status: 'requires_confirmation' });
    // Act
    const result = transition(intent.id, 'processing');
    // Assert
    assert.deepEqual(result, { changed: true, legal: true });
  });
  it('should write fields atomically with the status', () => {
    // Arrange
    const intent = persistIntent({
      status: 'unknown',
      bankReference: `ref-${faker.string.uuid()}`,
      error: faker.lorem.sentence(),
    });
    const operationId = `op-${faker.string.uuid()}`;
    // Act
    transition(intent.id, 'completed', { operation_id: operationId, error: null });
    // Assert
    assert.deepEqual(intentRow(intent.id), {
      ...intentRowOf(intent),
      status: 'completed',
      operation_id: operationId,
      error: null,
    });
  });
  it('should leave the other columns unchanged when only the status is given', () => {
    // Arrange
    const intent = persistIntent({
      status: 'unknown',
      bankReference: `ref-${faker.string.uuid()}`,
      operationId: `op-${faker.string.uuid()}`,
      error: faker.lorem.sentence(),
    });
    // Act
    transition(intent.id, 'completed');
    // Assert
    assert.deepEqual(intentRow(intent.id), { ...intentRowOf(intent), status: 'completed' });
  });
  it('should report changed=false for an unknown intent id', () => {
    // Arrange
    const id = `intent-${faker.string.uuid()}`;
    // Act
    const result = transition(id, 'processing');
    // Assert
    assert.equal(result.changed, false);
    assert.equal(intentRow(id), undefined);
  });
  it('should record no event when it writes a transition', () => {
    // Arrange
    const intent = persistIntent({ status: 'requires_confirmation' });
    const before = events();
    // Act
    transition(intent.id, 'processing');
    // Assert
    assert.deepEqual(events(), before);
  });
});
