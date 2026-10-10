import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { ZodError } from 'zod';
import { transferMoney } from './actions';
import { reconcileIntent } from './reconcile';
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
import { approvalsFor, eventsFor, intentRow } from '../../tests/support/db';
import { startLossyBank, type LossyBank } from '../../tests/support/network';
import { updateIntent } from '../persistence/intents';
import {
  persistIntent,
  toolContextFactory,
  transferInputFactory,
} from '../../tests/fixtures/factories';
import { accounts, customers, money, operators, unknown } from '../../tests/fixtures/world';
import type { ActionResult, ToolContext } from '../types';
/** Waits until the `hang` proxy holds a request, so the dispatch is in flight. */
async function held(network: LossyBank) {
  const deadline = Date.now() + 5000;
  while (network.lost === 0 && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(network.lost > 0, 'the dispatch never reached the bank proxy');
}
/** Proposes the transfer and confirms it, as the customer does through the approval card. */
async function confirmed(ctx: ToolContext, args: unknown): Promise<ActionResult> {
  const proposal = await transferMoney(ctx, args);
  if (proposal.status !== 'requires_confirmation') return proposal;
  ctx.approvalId = (proposal.approval as { id: string }).id;
  return transferMoney(ctx, args);
}
describe('transferMoney', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should propose the transfer for review without moving any money', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const before = await bankSnapshot();
    // Act
    const result = await transferMoney(ctx, input);
    // Assert
    assert.equal(result.status, 'requires_confirmation');
    assert.deepEqual((result.approval as { payload: unknown }).payload, input);
    assert.equal(intentRow(ctx.intentId)!.status, 'requires_confirmation');
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should reject a transfer to the same account without creating a proposal', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    // Act & Assert
    await assert.rejects(transferMoney(ctx, { ...input, toAccountId: input.fromAccountId }));
    assert.equal(approvalsFor(ctx.intentId), 0);
  });
  it('should reject an unknown destination account without creating a proposal', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    // Act & Assert
    await assert.rejects(transferMoney(ctx, { ...input, toAccountId: unknown.account }), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 400);
      return true;
    });
    assert.equal(approvalsFor(ctx.intentId), 0);
  });
  it('should propose a transfer between two accounts of the same customer', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    // Act
    const result = await transferMoney(ctx, { ...input, toAccountId: accounts.luciaSavings });
    // Assert
    assert.equal(result.status, 'requires_confirmation');
  });
  it('should reject an approval that was already used with a 409 and keep the ledger', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const proposal = await transferMoney(ctx, input);
    const approvalId = (proposal.approval as { id: string }).id;
    appDb()
      .prepare('UPDATE approvals SET consumed_at=? WHERE id=?')
      .run(new Date().toISOString(), approvalId);
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(transferMoney({ ...ctx, approvalId }, input), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 409);
      return true;
    });
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should complete the transfer and return the bank operation', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    // Act
    const result = await confirmed(ctx, input);
    // Assert
    assert.equal(result.status, 'completed');
    assert.equal(result.intentId, ctx.intentId);
    const operation = result.operation as { amountCents: number; fromAccountId: string };
    assert.equal(operation.amountCents, input.amountCents);
    assert.equal(operation.fromAccountId, input.fromAccountId);
  });
  it('should move the amount between both accounts exactly once', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const fromBefore = await balanceOf(input.fromAccountId);
    const toBefore = await balanceOf(input.toAccountId);
    const operationsBefore = (await operationsFor(ctx.userId)).length;
    // Act
    await confirmed(ctx, input);
    // Assert
    assert.equal(await balanceOf(input.fromAccountId), fromBefore - input.amountCents);
    assert.equal(await balanceOf(input.toAccountId), toBefore + input.amountCents);
    assert.equal((await operationsFor(ctx.userId)).length, operationsBefore + 1);
  });
  it('should record the completed intent with its operation and bank reference', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    // Act
    const result = await confirmed(ctx, input);
    // Assert
    const row = intentRow(ctx.intentId)!;
    const operation = result.operation as { id: string; reference: string };
    assert.equal(row.user_id, ctx.userId);
    assert.equal(row.status, 'completed');
    assert.equal(row.operation_id, operation.id);
    assert.equal(row.bank_reference, operation.reference);
    assert.deepEqual(JSON.parse(row.payload), input);
  });
  it('should stamp when the dispatch started as the intent enters processing', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const before = new Date().toISOString();
    // Act
    await confirmed(ctx, input);
    // Assert
    const { dispatched_at, created_at } = intentRow(ctx.intentId)!;
    assert.ok(
      dispatched_at && dispatched_at >= before && dispatched_at <= new Date().toISOString(),
    );
    assert.ok(dispatched_at >= created_at);
  });
  it('should record started and completed telemetry events for the run', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    // Act
    await confirmed(ctx, input);
    // Assert
    const events = eventsFor(ctx.runId);
    assert.deepEqual(
      events.map((e) => e.kind),
      ['transfer.started', 'transfer.completed'],
    );
    assert.ok(events.every((e) => e.userId === ctx.userId));
    assert.equal(events[1].data.status, 'completed');
  });
  it('should complete with a single bank operation when the bank rejects the first attempt before any effect', async () => {
    // Arrange
    const input = transferInputFactory.build();
    await resetBank('reject-before');
    const ctx = toolContextFactory.build();
    const operationsBefore = (await operationsFor(ctx.userId)).length;
    // Act
    const result = await confirmed(ctx, input);
    // Assert
    assert.equal(result.status, 'completed');
    assert.equal((await operationsFor(ctx.userId)).length, operationsBefore + 1);
  });
  it('should reject operators with a 403 and keep the ledger unchanged', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build({ userId: operators.marta });
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
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(
      transferMoney(ctx, { ...input, fromAccountId: accounts.bruno, toAccountId: accounts.lucia }),
      (e) => {
        assert.ok(e instanceof HttpError);
        assert.equal(e.status, 403);
        return true;
      },
    );
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should reject arguments that break the transfer schema', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const invalid = [
      { ...input, amountCents: 0 },
      { ...input, amountCents: -5 },
      { ...input, amountCents: 12.5 },
      { ...input, amountCents: money.maxTransferCents + 1 },
      { ...input, fromAccountId: '' },
      { ...input, concept: 'x'.repeat(201) },
      {
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        concept: input.concept,
      },
    ];
    // Act & Assert
    for (const args of invalid) {
      await assert.rejects(transferMoney(toolContextFactory.build(), args), ZodError);
    }
  });
  it('should reject unknown fields such as a model-supplied reference or actor', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(transferMoney(ctx, { ...input, userId: customers.bruno }), ZodError);
    await assert.rejects(transferMoney(ctx, { ...input, reference: 'chosen-by-model' }), ZodError);
    assert.deepEqual(await bankSnapshot(), before);
    assert.equal(intentRow(ctx.intentId), undefined);
  });
  it('should reject an override of a pending transfer smuggled into the transfer arguments', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const pending = persistIntent({ status: 'unknown', payload: input });
    const ctx = toolContextFactory.build();
    // Act & Assert
    await assert.rejects(
      transferMoney(ctx, { ...input, overridePendingIntentId: pending.id }),
      ZodError,
    );
    assert.equal(approvalsFor(ctx.intentId), 0);
  });
  it('should return the original operation when a completed intent is retried', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const first = await confirmed(ctx, input);
    const before = await bankSnapshot();
    // Act
    const retry = await confirmed(ctx, input);
    // Assert
    assert.equal(retry.status, 'completed');
    assert.equal((retry.operation as { id: string }).id, (first.operation as { id: string }).id);
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should keep a completed intent completed when it is retried while the bank is unreachable', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const first = await confirmed(ctx, input);
    const original = config.bankUrl;
    config.bankUrl = 'http://127.0.0.1:9';
    // Act
    let retry;
    try {
      retry = await confirmed(ctx, input);
    } finally {
      config.bankUrl = original;
    }
    // Assert
    assert.equal(retry.status, 'completed');
    assert.equal((retry.operation as { id: string }).id, (first.operation as { id: string }).id);
    assert.equal(intentRow(ctx.intentId)!.status, 'completed');
  });
  it('should record a transfer as unknown when every bank response is lost after commit', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const proposal = await transferMoney(ctx, input);
    ctx.approvalId = (proposal.approval as { id: string }).id;
    const operationsBefore = (await operationsFor(ctx.userId)).length;
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
    );
    // Act
    let result: ActionResult;
    try {
      result = await transferMoney(ctx, input);
    } finally {
      await network.close();
    }
    // Assert
    assert.equal(result.status, 'unknown');
    assert.equal(intentRow(ctx.intentId)!.status, 'unknown');
    assert.equal((await operationsFor(ctx.userId)).length, operationsBefore + 1);
  });
  it('should complete an unknown intent from the bank record when it is retried', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const proposal = await transferMoney(ctx, input);
    ctx.approvalId = (proposal.approval as { id: string }).id;
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
    );
    try {
      await transferMoney(ctx, input);
    } finally {
      await network.close();
    }
    const before = await bankSnapshot();
    // Act
    const retry = await transferMoney(ctx, input);
    // Assert
    assert.equal(retry.status, 'completed');
    const booked = before.operations.find(
      (o) => o.reference === intentRow(ctx.intentId)!.bank_reference,
    )!;
    assert.equal((retry.operation as { id: string }).id, booked.id);
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should record a transfer as unknown when the bank reply is an unreadable gateway page', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const proposal = await transferMoney(ctx, input);
    ctx.approvalId = (proposal.approval as { id: string }).id;
    const operationsBefore = (await operationsFor(ctx.userId)).length;
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
      'html-502',
    );
    // Act
    let result: ActionResult;
    try {
      result = await transferMoney(ctx, input);
    } finally {
      await network.close();
    }
    // Assert
    assert.equal(result.status, 'unknown');
    assert.equal(
      result.error,
      'The bank did not confirm this transfer. It will be checked with the bank before any retry.',
    );
    assert.equal(intentRow(ctx.intentId)!.status, 'unknown');
    assert.equal((await operationsFor(ctx.userId)).length, operationsBefore + 1);
  });
  it('should reconcile an unreadable bank reply to the completed operation the bank booked', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const proposal = await transferMoney(ctx, input);
    ctx.approvalId = (proposal.approval as { id: string }).id;
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
      'html-502',
    );
    try {
      await transferMoney(ctx, input);
    } finally {
      await network.close();
    }
    // Act
    await reconcileIntent(ctx.userId, ctx.intentId);
    // Assert
    const row = intentRow(ctx.intentId)!;
    const booked = (await bankSnapshot()).operations.find(
      (o) => o.reference === row.bank_reference,
    )!;
    assert.deepEqual(
      { status: row.status, operation_id: row.operation_id, error: row.error },
      { status: 'completed', operation_id: booked.id, error: null },
    );
  });
  it('should reject reusing an intent with a different payload as a 409 conflict', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    await confirmed(ctx, input);
    const before = await bankSnapshot();
    // Act & Assert
    await assert.rejects(
      transferMoney(ctx, { ...input, amountCents: input.amountCents + 1 }),
      (e) => {
        assert.ok(e instanceof HttpError);
        assert.equal(e.status, 409);
        return true;
      },
    );
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should reject an intent reused by another customer as a 409 conflict', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    await confirmed(ctx, input);
    const before = await bankSnapshot();
    const intruder = toolContextFactory.build({ userId: customers.bruno, intentId: ctx.intentId });
    // Act & Assert
    await assert.rejects(
      transferMoney(intruder, {
        ...input,
        fromAccountId: accounts.bruno,
        toAccountId: accounts.lucia,
      }),
      (e) => {
        assert.ok(e instanceof HttpError);
        assert.equal(e.status, 409);
        return true;
      },
    );
    assert.deepEqual(await bankSnapshot(), before);
    assert.equal(intentRow(ctx.intentId)!.user_id, ctx.userId);
  });
  it('should report insufficient funds as a failed result and keep the ledger unchanged', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const before = await bankSnapshot();
    // Act
    const result = await confirmed(ctx, { ...input, amountCents: money.maxTransferCents });
    // Assert
    assert.equal(result.status, 'failed');
    // The message text belongs to the bank; only its presence is part of the contract.
    assert.ok(result.error);
    assert.deepEqual(await bankSnapshot(), before);
  });
  it('should record the failed intent with the bank error and emit a failed event', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    // Act
    await confirmed(ctx, { ...input, amountCents: money.maxTransferCents });
    // Assert
    const row = intentRow(ctx.intentId)!;
    assert.equal(row.status, 'failed');
    assert.ok(row.error);
    assert.equal(row.operation_id, null);
    const kinds = eventsFor(ctx.runId).map((e) => e.kind);
    assert.deepEqual(kinds, ['transfer.started', 'transfer.failed']);
  });
  it('should reject re-proposing an intent whose transfer is already being sent with a 409', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    persistIntent({
      id: ctx.intentId,
      userId: ctx.userId,
      runId: ctx.runId,
      payload: input,
      status: 'processing',
      bankReference: `ref-${ctx.intentId}`,
    });
    // Act & Assert
    await assert.rejects(transferMoney(ctx, input), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 409);
      assert.equal(e.message, 'This transfer is already being sent.');
      return true;
    });
    assert.equal(intentRow(ctx.intentId)!.status, 'processing');
    assert.equal(approvalsFor(ctx.intentId), 0);
  });
  it('should reject a re-proposal while the dispatch is in flight and still complete the transfer', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const proposal = await transferMoney(ctx, input);
    const confirmation = { ...ctx, approvalId: (proposal.approval as { id: string }).id };
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
      'hang',
    );
    let dispatch: Promise<ActionResult> | undefined;
    let reproposal: unknown;
    try {
      dispatch = transferMoney(confirmation, input);
      await held(network);
      // Act
      reproposal = await transferMoney(ctx, input).catch((e) => e);
      network.release();
      await dispatch;
    } finally {
      network.release();
      await dispatch?.catch(() => {});
      await network.close();
    }
    // Assert
    assert.ok(reproposal instanceof HttpError);
    assert.equal(reproposal.status, 409);
    const row = intentRow(ctx.intentId)!;
    const booked = (await bankSnapshot()).operations.find(
      (o) => o.reference === row.bank_reference,
    )!;
    assert.deepEqual(
      { status: row.status, operation_id: row.operation_id },
      { status: 'completed', operation_id: booked.id },
    );
  });
  it('should answer with the stored outcome when another writer settled the intent during the dispatch', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    const proposal = await transferMoney(ctx, input);
    ctx.approvalId = (proposal.approval as { id: string }).id;
    const settledId = `op-${faker.string.uuid()}`;
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
      'hang',
    );
    let dispatch: Promise<ActionResult> | undefined;
    let result: ActionResult;
    try {
      dispatch = transferMoney(ctx, input);
      await held(network);
      updateIntent(ctx.intentId, { status: 'completed', operation_id: settledId });
      network.release();
      // Act
      result = await dispatch;
    } finally {
      network.release();
      await dispatch?.catch(() => {});
      await network.close();
    }
    // Assert
    assert.equal(result.status, 'completed');
    assert.equal((result.operation as { id: string }).id, settledId);
    assert.equal(intentRow(ctx.intentId)!.operation_id, settledId);
  });
});
