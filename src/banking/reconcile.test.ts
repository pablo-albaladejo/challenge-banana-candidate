import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { reconcileIntent } from './reconcile';
import { config } from '../config';
import { bankSnapshot, resetBank, startBank, stopBank } from '../../tests/support/bank';
import { intentRow } from '../../tests/support/db';
import { persistIntent } from '../../tests/fixtures/factories';
import { customers, historicTransfer } from '../../tests/fixtures/world';
const lostResponse = 'No response received from the bank.';
const unsentReference = () => `ref-${faker.string.uuid()}`;
describe('reconcileIntent', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should mark an unknown intent completed when the bank has its operation', async () => {
    // Arrange
    const { id } = persistIntent({
      status: 'unknown',
      bankReference: historicTransfer.reference,
      payload: historicTransfer.payload,
      error: lostResponse,
    });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    const operation = (await bankSnapshot()).operations.find(
      (o) => o.reference === historicTransfer.reference,
    )!;
    const { status, operation_id, error } = intentRow(id)!;
    assert.deepEqual(
      { status, operation_id, error },
      { status: 'completed', operation_id: operation.id, error: null },
    );
  });
  it('should verify a transport failure recorded as failed against the bank', async () => {
    // Arrange
    const { id } = persistIntent({
      status: 'failed',
      bankReference: historicTransfer.reference,
      payload: historicTransfer.payload,
      error: lostResponse,
    });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    assert.equal(intentRow(id)!.status, 'completed');
  });
  it('should mark an unknown intent failed when the bank verifies it has no operation', async () => {
    // Arrange
    const { id } = persistIntent({ status: 'unknown', bankReference: unsentReference() });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    assert.equal(intentRow(id)!.status, 'failed');
    assert.match(intentRow(id)!.error!, /no operation/i);
  });
  it('should keep the intent unknown while the bank cannot be reached', async () => {
    // Arrange
    const { id } = persistIntent({ status: 'unknown', bankReference: unsentReference() });
    const original = config.bankUrl;
    config.bankUrl = 'http://127.0.0.1:9';
    // Act
    try {
      await reconcileIntent(customers.lucia, id);
    } finally {
      config.bankUrl = original;
    }
    // Assert
    assert.equal(intentRow(id)!.status, 'unknown');
  });
  it('should leave intents that were never sent to the bank untouched', async () => {
    // Arrange
    const { id } = persistIntent({ status: 'requires_confirmation' });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    assert.equal(intentRow(id)!.status, 'requires_confirmation');
  });
});
