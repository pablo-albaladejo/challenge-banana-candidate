import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { reconcileIntent } from './reconcile';
import { transferMoney } from './transfer-money';
import { startLossyBank } from '../../tests/support/network';
import * as bank from '../platform/bank/bank';
import { config } from '../platform/config';
import { bankSnapshot, resetBank, startBank, stopBank } from '../../tests/support/bank';
import { intentRow } from '../../tests/support/db';
import {
  persistIntent,
  toolContextFactory,
  transferInputFactory,
} from '../../tests/fixtures/factories';
import { customers, historicTransfer } from '../../tests/fixtures/world';
const lostResponse = 'No response received from the bank.';
const unsentReference = () => `ref-${faker.string.uuid()}`;
/** A creation time well past any dispatch still in flight: older than every bank attempt can last. */
const longAgo = () => new Date(Date.now() - 60 * config.bankTimeoutMs).toISOString();
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
    const { id } = persistIntent({
      status: 'unknown',
      bankReference: unsentReference(),
      createdAt: longAgo(),
    });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    assert.equal(intentRow(id)!.status, 'failed');
    assert.match(intentRow(id)!.error!, /no operation/i);
  });
  it('should keep a fresh unknown intent unknown while the bank has no operation for it yet', async () => {
    // Arrange
    const { id } = persistIntent({
      status: 'unknown',
      bankReference: unsentReference(),
      dispatchedAt: new Date().toISOString(),
    });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    assert.equal(intentRow(id)!.status, 'unknown');
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
  it('should complete a stale processing intent when the bank booked its reference', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const reference = unsentReference();
    const operation = await bank.transfer(customers.lucia, input, reference);
    const { id } = persistIntent({
      status: 'processing',
      payload: input,
      bankReference: reference,
      createdAt: longAgo(),
    });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    const { status, operation_id } = intentRow(id)!;
    assert.deepEqual({ status, operation_id }, { status: 'completed', operation_id: operation.id });
  });
  it('should fail a stale processing intent when the bank has no operation for its reference', async () => {
    // Arrange
    const { id } = persistIntent({
      status: 'processing',
      bankReference: unsentReference(),
      createdAt: longAgo(),
    });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    assert.equal(intentRow(id)!.status, 'failed');
    assert.match(intentRow(id)!.error!, /no operation/i);
  });
  it('should leave a recent processing intent to the dispatch still in flight', async () => {
    // Arrange
    const { id } = persistIntent({ status: 'processing', bankReference: unsentReference() });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    assert.equal(intentRow(id)!.status, 'processing');
  });
  it('should leave a processing intent of an old proposal whose dispatch started recently', async () => {
    // Arrange
    const { id } = persistIntent({
      status: 'processing',
      bankReference: unsentReference(),
      createdAt: longAgo(),
      dispatchedAt: new Date().toISOString(),
    });
    // Act
    await reconcileIntent(customers.lucia, id);
    // Assert
    assert.equal(intentRow(id)!.status, 'processing');
  });
  it('should keep a stale processing intent unchanged while the bank cannot be reached', async () => {
    // Arrange
    const { id } = persistIntent({
      status: 'processing',
      bankReference: unsentReference(),
      createdAt: longAgo(),
    });
    const original = config.bankUrl;
    config.bankUrl = 'http://127.0.0.1:9';
    // Act
    try {
      await reconcileIntent(customers.lucia, id);
    } finally {
      config.bankUrl = original;
    }
    // Assert
    assert.equal(intentRow(id)!.status, 'processing');
  });
  it('should leave an old proposal to its dispatch still in flight and let it complete', async () => {
    // Arrange
    const originalTimeout = config.bankTimeoutMs;
    config.bankTimeoutMs = 10_000; // the held request must outlive no client timeout
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build();
    persistIntent({
      id: ctx.intentId,
      runId: ctx.runId,
      payload: input,
      status: 'requires_confirmation',
      createdAt: longAgo(),
    });
    const proposal = await transferMoney(ctx, input);
    ctx.approvalId = (proposal.approval as { id: string }).id;
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
      'hang',
    );
    let duringDispatch: string | undefined;
    let dispatch: Promise<unknown> | undefined;
    try {
      dispatch = transferMoney(ctx, input);
      const deadline = Date.now() + 5000;
      while (network.lost === 0 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.ok(network.lost > 0, 'the dispatch never reached the bank proxy');
      // Act
      await reconcileIntent(ctx.userId, ctx.intentId);
      duringDispatch = intentRow(ctx.intentId)!.status;
      network.release();
      await dispatch;
    } finally {
      network.release();
      await dispatch?.catch(() => {});
      await network.close();
      config.bankTimeoutMs = originalTimeout;
    }
    // Assert
    const booked = (await bankSnapshot()).operations.find(
      (o) => o.reference === intentRow(ctx.intentId)!.bank_reference,
    )!;
    assert.equal(duringDispatch, 'processing');
    const { status, operation_id } = intentRow(ctx.intentId)!;
    assert.deepEqual({ status, operation_id }, { status: 'completed', operation_id: booked.id });
  });
});
