import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import {
  insertIntent,
  insertIntentIfAbsent,
  intentById,
  intentOf,
  intentsIn,
  unsettledIntentIds,
  updateIntent,
} from './intents';
import { intentFactory, intentRowOf, storedIntent } from '../../tests/fixtures/factories';
import { intentRow } from '../../tests/support/db';
import { customers } from '../../tests/fixtures/world';

describe('intents repository', () => {
  it('should read back a stored intent in any status', () => {
    // Arrange
    const intent = intentFactory.build({
      status: 'failed',
      bankReference: `ref-${faker.string.uuid()}`,
      error: faker.lorem.sentence(),
    });
    // Act
    insertIntent(storedIntent(intent));
    // Assert
    assert.deepEqual(intentById(intent.id), intentRowOf(intent));
  });
  it('should keep the first intent when the same id is stored again if absent', () => {
    // Arrange
    const intent = intentFactory.build();
    insertIntentIfAbsent(storedIntent(intent));
    // Act
    const changes = insertIntentIfAbsent(storedIntent({ ...intent, status: 'completed' }));
    // Assert
    assert.equal(changes, 0);
    assert.deepEqual(intentRow(intent.id), intentRowOf(intent));
  });
  it('should find an intent only for its owner', () => {
    // Arrange
    const intent = intentFactory.build();
    insertIntent(storedIntent(intent));
    // Act
    const owned = intentOf(intent.id, intent.userId);
    const foreign = intentOf(intent.id, customers.bruno);
    // Assert
    assert.deepEqual(owned, intentRowOf(intent));
    assert.equal(foreign, undefined);
  });
  it('should write only the given fields of an intent', () => {
    // Arrange
    const intent = intentFactory.build({ bankReference: `ref-${faker.string.uuid()}` });
    insertIntent(storedIntent(intent));
    const operationId = `op-${faker.string.uuid()}`;
    // Act
    const changes = updateIntent(intent.id, {
      status: 'completed',
      operation_id: operationId,
      error: null,
    });
    // Assert
    assert.equal(changes, 1);
    assert.deepEqual(intentRow(intent.id), {
      ...intentRowOf(intent),
      status: 'completed',
      operation_id: operationId,
      error: null,
    });
  });
  it('should list the intents of a conversation oldest first', () => {
    // Arrange
    const conversationId = `conv-${faker.string.uuid()}`;
    const newer = intentFactory.build({ conversationId, createdAt: '2026-09-02T10:00:00.000Z' });
    const older = intentFactory.build({ conversationId, createdAt: '2026-09-01T10:00:00.000Z' });
    insertIntent(storedIntent(newer));
    insertIntent(storedIntent(older));
    // Act
    const list = intentsIn(conversationId);
    // Assert
    assert.deepEqual(list, [intentRowOf(older), intentRowOf(newer)]);
  });
  it('should name the unknown and failed intents of a conversation as unsettled', () => {
    // Arrange
    const conversationId = `conv-${faker.string.uuid()}`;
    const unknown = intentFactory.build({ conversationId, status: 'unknown' });
    const failed = intentFactory.build({ conversationId, status: 'failed' });
    const completed = intentFactory.build({ conversationId, status: 'completed' });
    for (const intent of [unknown, failed, completed]) insertIntent(storedIntent(intent));
    // Act
    const ids = unsettledIntentIds(conversationId).map((i) => i.id);
    // Assert
    assert.deepEqual(ids.sort(), [unknown.id, failed.id].sort());
  });
});
