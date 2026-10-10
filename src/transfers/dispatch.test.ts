import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchTransfer } from './dispatch';
import { BankError } from '../platform/bank/client';
import {
  bankSnapshot,
  operationsFor,
  resetBank,
  startBank,
  stopBank,
} from '../../tests/support/bank';
import { intentRow } from '../../tests/support/db';
import { persistIntent, toolContextFactory } from '../../tests/fixtures/factories';
import { customers, money } from '../../tests/fixtures/world';
/** dispatchTransfer expects the intent row that transferMoney creates before dispatching. */
function processingIntent() {
  const intent = persistIntent({ status: 'processing' });
  const ctx = toolContextFactory.build({
    userId: intent.userId,
    runId: intent.runId!,
    intentId: intent.id,
  });
  return { ctx, input: intent.payload };
}
describe('dispatchTransfer', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should return the completed bank operation for the actor', async () => {
    // Arrange
    const { ctx, input } = processingIntent();
    // Act
    const operation = await dispatchTransfer(ctx, input);
    // Assert
    assert.equal(operation.status, 'completed');
    assert.equal(operation.userId, ctx.userId);
    assert.equal(operation.amountCents, input.amountCents);
    assert.equal(operation.toAccountId, input.toAccountId);
  });
  it('should store the reference sent to the bank on the intent', async () => {
    // Arrange
    const { ctx, input } = processingIntent();
    // Act
    const operation = await dispatchTransfer(ctx, input);
    // Assert
    assert.equal(intentRow(ctx.intentId)!.bank_reference, operation.reference);
    const ledger = await operationsFor(customers.lucia);
    assert.ok(ledger.some((o) => o.id === operation.id && o.reference === operation.reference));
  });
  it('should retry a 503 rejected before any effect and commit a single operation', async () => {
    // Arrange
    await resetBank('reject-before');
    const { ctx, input } = processingIntent();
    const operationsBefore = (await operationsFor(customers.lucia)).length;
    // Act
    const operation = await dispatchTransfer(ctx, input);
    // Assert
    assert.equal(operation.status, 'completed');
    assert.equal((await operationsFor(customers.lucia)).length, operationsBefore + 1);
    assert.equal(intentRow(ctx.intentId)!.bank_reference, operation.reference);
  });
  for (const profile of ['lost-response', 'slow-response', 'read-unavailable'] as const) {
    it(`should commit a single operation when the bank commits but the response is lost (${profile})`, async () => {
      // Arrange
      await resetBank(profile);
      const { ctx, input } = processingIntent();
      const operationsBefore = (await operationsFor(customers.lucia)).length;
      // Act
      const operation = await dispatchTransfer(ctx, input);
      // Assert
      assert.equal(operation.status, 'completed');
      assert.equal((await operationsFor(customers.lucia)).length, operationsBefore + 1);
      assert.equal(intentRow(ctx.intentId)!.bank_reference, operation.reference);
    });
  }
  it('should reuse the intent reference when the same intent is dispatched again', async () => {
    // Arrange
    const { ctx, input } = processingIntent();
    const first = await dispatchTransfer(ctx, input);
    const operationsBefore = (await operationsFor(customers.lucia)).length;
    // Act
    const second = await dispatchTransfer(ctx, input);
    // Assert
    assert.equal(second.id, first.id);
    assert.equal((await operationsFor(customers.lucia)).length, operationsBefore);
  });
  it('should surface a client error from the bank without retrying it', async () => {
    // Arrange
    const { ctx, input } = processingIntent();
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(
      dispatchTransfer(ctx, { ...input, amountCents: money.maxTransferCents }),
      (e) => {
        assert.ok(e instanceof BankError);
        assert.equal(e.status, 422);
        return true;
      },
    );
    assert.deepEqual(await bankSnapshot(), before);
  });
});
