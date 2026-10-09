import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { transferMoney } from './actions';
import { HttpError } from '../auth';
import { appDb } from '../db';
import { config } from '../config';
import {
  balanceOf,
  bankSnapshot,
  operationsFor,
  resetBank,
  startBank,
  stopBank,
} from '../../tests/support/bank';
import type { ToolContext } from '../types';
type IntentRow = {
  user_id: string;
  payload: string;
  status: string;
  bank_reference: string | null;
  operation_id: string | null;
  error: string | null;
};
const context = (userId = 'lucia'): ToolContext => ({
  userId,
  conversationId: null,
  runId: `run-${randomUUID()}`,
  intentId: `intent-${randomUUID()}`,
});
const intentRow = (id: string) =>
  appDb().prepare('SELECT * FROM intents WHERE id=?').get(id) as IntentRow | undefined;
const input = {
  fromAccountId: 'acc-lucia',
  toAccountId: 'acc-bruno',
  amountCents: 1250,
  concept: 'Shared lunch',
};
describe('transferMoney', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should complete the transfer and return the bank operation', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = await transferMoney(ctx, input);
    // Assert
    assert.equal(result.status, 'completed');
    assert.equal(result.intentId, ctx.intentId);
    const operation = result.operation as { amountCents: number; fromAccountId: string };
    assert.equal(operation.amountCents, input.amountCents);
    assert.equal(operation.fromAccountId, input.fromAccountId);
  });
  it('should move the amount between both accounts exactly once', async () => {
    // Arrange
    const ctx = context();
    const fromBefore = await balanceOf('acc-lucia');
    const toBefore = await balanceOf('acc-bruno');
    const operationsBefore = (await operationsFor('lucia')).length;
    // Act
    await transferMoney(ctx, input);
    // Assert
    assert.equal(await balanceOf('acc-lucia'), fromBefore - input.amountCents);
    assert.equal(await balanceOf('acc-bruno'), toBefore + input.amountCents);
    assert.equal((await operationsFor('lucia')).length, operationsBefore + 1);
  });
  it('should record the completed intent with its operation and bank reference', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = await transferMoney(ctx, input);
    // Assert
    const row = intentRow(ctx.intentId)!;
    const operation = result.operation as { id: string; reference: string };
    assert.equal(row.user_id, 'lucia');
    assert.equal(row.status, 'completed');
    assert.equal(row.operation_id, operation.id);
    assert.equal(row.bank_reference, operation.reference);
    assert.deepEqual(JSON.parse(row.payload), input);
  });
  it('should record started and completed telemetry events for the run', async () => {
    // Arrange
    const ctx = context();
    // Act
    await transferMoney(ctx, input);
    // Assert
    const events = appDb()
      .prepare('SELECT kind,user_id,data FROM events WHERE run_id=? ORDER BY rowid')
      .all(ctx.runId) as { kind: string; user_id: string; data: string }[];
    assert.deepEqual(
      events.map((e) => e.kind),
      ['transfer.started', 'transfer.completed'],
    );
    assert.ok(events.every((e) => e.user_id === 'lucia'));
    assert.equal(JSON.parse(events[1].data).status, 'completed');
  });
  it('should complete with a single bank operation when the bank rejects the first attempt before any effect', async () => {
    // Arrange
    await resetBank('reject-before');
    const ctx = context();
    const operationsBefore = (await operationsFor('lucia')).length;
    // Act
    const result = await transferMoney(ctx, input);
    // Assert
    assert.equal(result.status, 'completed');
    assert.equal((await operationsFor('lucia')).length, operationsBefore + 1);
  });
  it('should reject operators with a 403 and keep the ledger unchanged', async () => {
    // Arrange
    const ctx = context('marta');
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(transferMoney(ctx, input), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 403);
      return true;
    });
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should reject a source account owned by someone else with a 403 and keep the ledger unchanged', async () => {
    // Arrange
    const ctx = context();
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(transferMoney(ctx, { ...input, fromAccountId: 'acc-bruno' }), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 403);
      return true;
    });
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should reject arguments that break the transfer schema', async () => {
    // Arrange
    const invalid = [
      { ...input, amountCents: 0 },
      { ...input, amountCents: -5 },
      { ...input, amountCents: 12.5 },
      { ...input, amountCents: 10000001 },
      { ...input, fromAccountId: '' },
      { ...input, concept: 'x'.repeat(201) },
      { fromAccountId: 'acc-lucia', toAccountId: 'acc-bruno', concept: 'No amount' },
    ];
    // Act & Assert
    for (const args of invalid) {
      await assert.rejects(transferMoney(context(), args), ZodError);
    }
  });
  it('should reject unknown fields such as a model-supplied reference or actor', async () => {
    // Arrange
    const ctx = context();
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(transferMoney(ctx, { ...input, userId: 'bruno' }), ZodError);
    await assert.rejects(transferMoney(ctx, { ...input, reference: 'chosen-by-model' }), ZodError);
    assert.deepEqual(await bankSnapshot(), before);
    assert.equal(intentRow(ctx.intentId), undefined);
  });
  it('should return the original operation when a completed intent is retried', async () => {
    // Arrange
    const ctx = context();
    const first = await transferMoney(ctx, input);
    const before = await bankSnapshot();
    // Act
    const retry = await transferMoney(ctx, input);
    // Assert
    assert.equal(retry.status, 'completed');
    assert.equal((retry.operation as { id: string }).id, (first.operation as { id: string }).id);
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should keep a completed intent completed when it is retried while the bank is unreachable', async () => {
    // Arrange
    const ctx = context();
    const first = await transferMoney(ctx, input);
    const original = config.bankUrl;
    config.bankUrl = 'http://127.0.0.1:9';
    // Act
    let retry;
    try {
      retry = await transferMoney(ctx, input);
    } finally {
      config.bankUrl = original;
    }
    // Assert
    assert.equal(retry.status, 'completed');
    assert.equal((retry.operation as { id: string }).id, (first.operation as { id: string }).id);
    assert.equal(intentRow(ctx.intentId)!.status, 'completed');
  });
  it('should reject reusing an intent with a different payload as a 409 conflict', async () => {
    // Arrange
    const ctx = context();
    await transferMoney(ctx, input);
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(transferMoney(ctx, { ...input, amountCents: 9999 }), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 409);
      return true;
    });
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should reject an intent reused by another customer as a 409 conflict', async () => {
    // Arrange
    const ctx = context();
    await transferMoney(ctx, input);
    const before = await bankSnapshot();
    const intruder = { ...context('bruno'), intentId: ctx.intentId };
    // Act & Assert
    await assert.rejects(
      transferMoney(intruder, { ...input, fromAccountId: 'acc-bruno', toAccountId: 'acc-lucia' }),
      (e) => {
        assert.ok(e instanceof HttpError);
        assert.equal(e.status, 409);
        return true;
      },
    );
    assert.deepEqual(await bankSnapshot(), before);
    assert.equal(intentRow(ctx.intentId)!.user_id, 'lucia');
  });
  it('should report insufficient funds as a failed result and keep the ledger unchanged', async () => {
    // Arrange
    const ctx = context();
    const before = await bankSnapshot();
    // Act
    const result = await transferMoney(ctx, { ...input, amountCents: 10000000 });
    // Assert
    assert.equal(result.status, 'failed');
    // The message text belongs to the bank; only its presence is part of the contract.
    assert.ok(result.error);
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should record the failed intent with the bank error and emit a failed event', async () => {
    // Arrange
    const ctx = context();
    // Act
    await transferMoney(ctx, { ...input, amountCents: 10000000 });
    // Assert
    const row = intentRow(ctx.intentId)!;
    assert.equal(row.status, 'failed');
    assert.ok(row.error);
    assert.equal(row.operation_id, null);
    const kinds = (
      appDb().prepare('SELECT kind FROM events WHERE run_id=? ORDER BY rowid').all(ctx.runId) as {
        kind: string;
      }[]
    ).map((e) => e.kind);
    assert.deepEqual(kinds, ['transfer.started', 'transfer.failed']);
  });
});
