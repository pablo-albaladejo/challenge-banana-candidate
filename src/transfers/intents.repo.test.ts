import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import {
  insertIntent,
  insertIntentIfAbsent,
  intentById,
  intentOf,
  intentsIn,
  pendingIntentsOf,
  pendingTwinsOf,
  unsettledIntentIds,
  transitionIntent,
  updateIntent,
} from './intents.repo';
import {
  intentFactory,
  intentRowOf,
  storedIntent,
  transferInputFactory,
} from '../../tests/fixtures/factories';
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
  it('should list the newest unknown and processing intents of a customer up to the limit', () => {
    // Arrange
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const owner = customers.omar;
    const [oldest, middle, newest] = (['unknown', 'processing', 'unknown'] as const).map(
      (status, i) => intentFactory.build({ userId: owner, status, createdAt: at(30 - i) }),
    );
    const others = [
      intentFactory.build({ userId: owner, status: 'completed', createdAt: at(1) }),
      intentFactory.build({ userId: owner, status: 'failed', createdAt: at(1) }),
      intentFactory.build({ userId: customers.bruno, status: 'unknown', createdAt: at(1) }),
    ];
    for (const intent of [oldest, middle, newest, ...others]) insertIntent(storedIntent(intent));
    // Act
    const pending = pendingIntentsOf(owner, 2);
    // Assert
    assert.deepEqual(pending, [intentRowOf(newest), intentRowOf(middle)]);
  });
  it('should name the other unsettled intents of a customer with the same payload, newest first', () => {
    // Arrange
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const owner = customers.ines;
    const payload = transferInputFactory.build();
    const older = intentFactory.build({
      userId: owner,
      payload,
      status: 'unknown',
      createdAt: at(9),
    });
    const newer = intentFactory.build({
      userId: owner,
      payload,
      status: 'processing',
      createdAt: at(5),
    });
    const current = intentFactory.build({
      userId: owner,
      payload,
      status: 'unknown',
      createdAt: at(1),
    });
    const others = [
      intentFactory.build({ userId: owner, payload, status: 'completed' }),
      intentFactory.build({ userId: owner, payload, status: 'failed' }),
      intentFactory.build({ userId: customers.bruno, payload, status: 'unknown' }),
      intentFactory.build({ userId: owner, status: 'unknown' }),
    ];
    for (const intent of [older, newer, current, ...others]) insertIntent(storedIntent(intent));
    // Act
    const twins = pendingTwinsOf(owner, JSON.stringify(payload), current.id);
    // Assert
    assert.deepEqual(twins, [intentRowOf(newer), intentRowOf(older)]);
  });
  it('should write the status and fields only when the stored status is an allowed one', () => {
    // Arrange
    const intent = intentFactory.build({ status: 'unknown' });
    insertIntent(storedIntent(intent));
    const operationId = `op-${faker.string.uuid()}`;
    // Act
    const changes = transitionIntent(intent.id, 'completed', ['unknown', 'failed'], {
      operation_id: operationId,
    });
    // Assert
    assert.equal(changes, 1);
    assert.deepEqual(intentRow(intent.id), {
      ...intentRowOf(intent),
      status: 'completed',
      operation_id: operationId,
    });
  });
  it('should leave the intent untouched when its stored status is not an allowed one', () => {
    // Arrange
    const intent = intentFactory.build({ status: 'completed' });
    insertIntent(storedIntent(intent));
    // Act
    const changes = transitionIntent(intent.id, 'processing', ['requires_confirmation'], {
      error: faker.lorem.sentence(),
    });
    // Assert
    assert.equal(changes, 0);
    assert.deepEqual(intentRow(intent.id), intentRowOf(intent));
  });
  it('should also list the recent failed intents that reached the bank', () => {
    // Arrange
    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    const owner = customers.elena;
    const reference = () => `ref-${faker.string.uuid()}`;
    const recent = intentFactory.build({
      userId: owner,
      status: 'failed',
      bankReference: reference(),
      createdAt: at(30),
      dispatchedAt: at(2),
    });
    const others = [
      intentFactory.build({
        userId: owner,
        status: 'failed',
        bankReference: reference(),
        createdAt: at(25),
      }),
      intentFactory.build({ userId: owner, status: 'failed', createdAt: at(1) }),
    ];
    for (const intent of [recent, ...others]) insertIntent(storedIntent(intent));
    // Act
    const pending = pendingIntentsOf(owner, 10);
    // Assert
    assert.deepEqual(pending, [intentRowOf(recent)]);
  });
  it('should rank the unsettled intents ahead of newer failed ones when the limit cuts the list', () => {
    // Arrange
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const owner = customers.hugo;
    const unsettled = intentFactory.build({ userId: owner, status: 'unknown', createdAt: at(60) });
    const failed = intentFactory.build({
      userId: owner,
      status: 'failed',
      bankReference: `ref-${faker.string.uuid()}`,
      createdAt: at(5),
      dispatchedAt: at(5),
    });
    for (const intent of [unsettled, failed]) insertIntent(storedIntent(intent));
    // Act
    const pending = pendingIntentsOf(owner, 1);
    // Assert
    assert.deepEqual(pending, [intentRowOf(unsettled)]);
  });
});
