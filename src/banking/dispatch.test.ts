import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dispatchTransfer } from './dispatch';
import { BankError } from './client';
import { appDb } from '../db';
import {
  bankSnapshot,
  operationsFor,
  resetBank,
  startBank,
  stopBank,
} from '../../tests/support/bank';
import type { ToolContext, TransferInput } from '../types';
const input: TransferInput = {
  fromAccountId: 'acc-lucia',
  toAccountId: 'acc-bruno',
  amountCents: 700,
  concept: 'Coffee',
};
/** dispatchTransfer expects the intent row that transferMoney creates before dispatching. */
function processingIntent(): ToolContext {
  const ctx: ToolContext = {
    userId: 'lucia',
    conversationId: null,
    runId: `run-${randomUUID()}`,
    intentId: `intent-${randomUUID()}`,
  };
  appDb()
    .prepare('INSERT INTO intents VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(
      ctx.intentId,
      ctx.userId,
      null,
      ctx.runId,
      JSON.stringify(input),
      'processing',
      null,
      null,
      null,
      new Date().toISOString(),
    );
  return ctx;
}
const bankReference = (intentId: string) =>
  (
    appDb().prepare('SELECT bank_reference FROM intents WHERE id=?').get(intentId) as {
      bank_reference: string | null;
    }
  ).bank_reference;
describe('dispatchTransfer', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should return the completed bank operation for the actor', async () => {
    // Arrange
    const ctx = processingIntent();
    // Act
    const operation = await dispatchTransfer(ctx, input);
    // Assert
    assert.equal(operation.status, 'completed');
    assert.equal(operation.userId, 'lucia');
    assert.equal(operation.amountCents, input.amountCents);
    assert.equal(operation.toAccountId, input.toAccountId);
  });
  it('should store the reference sent to the bank on the intent', async () => {
    // Arrange
    const ctx = processingIntent();
    // Act
    const operation = await dispatchTransfer(ctx, input);
    // Assert
    assert.equal(bankReference(ctx.intentId), operation.reference);
    const ledger = await operationsFor('lucia');
    assert.ok(ledger.some((o) => o.id === operation.id && o.reference === operation.reference));
  });
  it('should retry a 503 rejected before any effect and commit a single operation', async () => {
    // Arrange
    await resetBank('reject-before');
    const ctx = processingIntent();
    const operationsBefore = (await operationsFor('lucia')).length;
    // Act
    const operation = await dispatchTransfer(ctx, input);
    // Assert
    assert.equal(operation.status, 'completed');
    assert.equal((await operationsFor('lucia')).length, operationsBefore + 1);
    assert.equal(bankReference(ctx.intentId), operation.reference);
  });
  for (const profile of ['lost-response', 'slow-response', 'read-unavailable'] as const) {
    it(`should commit a single operation when the bank commits but the response is lost (${profile})`, async () => {
      // Arrange
      await resetBank(profile);
      const ctx = processingIntent();
      const operationsBefore = (await operationsFor('lucia')).length;
      // Act
      const operation = await dispatchTransfer(ctx, input);
      // Assert
      assert.equal(operation.status, 'completed');
      assert.equal((await operationsFor('lucia')).length, operationsBefore + 1);
      assert.equal(bankReference(ctx.intentId), operation.reference);
    });
  }
  it('should reuse the intent reference when the same intent is dispatched again', async () => {
    // Arrange
    const ctx = processingIntent();
    const first = await dispatchTransfer(ctx, input);
    const operationsBefore = (await operationsFor('lucia')).length;
    // Act
    const second = await dispatchTransfer(ctx, input);
    // Assert
    assert.equal(second.id, first.id);
    assert.equal((await operationsFor('lucia')).length, operationsBefore);
  });
  it('should surface a client error from the bank without retrying it', async () => {
    // Arrange
    const ctx = processingIntent();
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(dispatchTransfer(ctx, { ...input, amountCents: 10000000 }), (e) => {
      assert.ok(e instanceof BankError);
      assert.equal(e.status, 422);
      return true;
    });
    assert.deepEqual(await bankSnapshot(), before);
  });
});
