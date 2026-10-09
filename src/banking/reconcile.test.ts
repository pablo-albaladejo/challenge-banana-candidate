import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reconcileIntent } from './reconcile';
import { appDb } from '../db';
import { config } from '../config';
import { bankSnapshot, resetBank, startBank, stopBank } from '../../tests/support/bank';
type IntentRow = { status: string; operation_id: string | null; error: string | null };
const payload = {
  fromAccountId: 'acc-lucia',
  toAccountId: 'acc-bruno',
  amountCents: 8500,
  concept: 'Team dinner',
};
function intent(status: string, reference: string | null, error: string | null = null) {
  const id = `intent-${randomUUID()}`;
  appDb()
    .prepare('INSERT INTO intents VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(
      id,
      'lucia',
      null,
      'run-test',
      JSON.stringify(payload),
      status,
      reference,
      null,
      error,
      new Date().toISOString(),
    );
  return id;
}
const row = (id: string) =>
  appDb().prepare('SELECT status,operation_id,error FROM intents WHERE id=?').get(id) as IntentRow;
const historicReference = async () =>
  (await bankSnapshot()).operations.find((o) => o.userId === 'lucia')!.reference;
describe('reconcileIntent', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should mark an unknown intent completed when the bank has its operation', async () => {
    // Arrange
    const reference = await historicReference();
    const id = intent('unknown', reference, 'No response received from the bank.');
    // Act
    await reconcileIntent('lucia', id);
    // Assert
    const operation = (await bankSnapshot()).operations.find((o) => o.reference === reference)!;
    assert.deepEqual(row(id), { status: 'completed', operation_id: operation.id, error: null });
  });
  it('should verify a transport failure recorded as failed against the bank', async () => {
    // Arrange
    const reference = await historicReference();
    const id = intent('failed', reference, 'No response received from the bank.');
    // Act
    await reconcileIntent('lucia', id);
    // Assert
    assert.equal(row(id).status, 'completed');
  });
  it('should mark an unknown intent failed when the bank verifies it has no operation', async () => {
    // Arrange
    const id = intent('unknown', `ref-${randomUUID()}`);
    // Act
    await reconcileIntent('lucia', id);
    // Assert
    assert.equal(row(id).status, 'failed');
    assert.match(row(id).error!, /no operation/i);
  });
  it('should keep the intent unknown while the bank cannot be reached', async () => {
    // Arrange
    const id = intent('unknown', `ref-${randomUUID()}`);
    const original = config.bankUrl;
    config.bankUrl = 'http://127.0.0.1:9';
    // Act
    try {
      await reconcileIntent('lucia', id);
    } finally {
      config.bankUrl = original;
    }
    // Assert
    assert.equal(row(id).status, 'unknown');
  });
  it('should leave intents that were never sent to the bank untouched', async () => {
    // Arrange
    const id = intent('requires_confirmation', null);
    // Act
    await reconcileIntent('lucia', id);
    // Assert
    assert.equal(row(id).status, 'requires_confirmation');
  });
});
