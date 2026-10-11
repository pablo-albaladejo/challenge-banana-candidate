import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wireTransfers } from '../../entry-points/dependencies';
import { DomainError } from '../../../shared/domain/errors';
import { httpStatusOf } from '../../../platform/http/errors';
import { seedApp } from '../../../server/seed';
import { httpTransfersBank } from '../../infrastructure/http-transfers-bank.adapter';
import { timeOf } from '../../domain/preflight-messages';
import type { PreflightCheck } from '../../domain/preflight';
import { balanceOf, resetBank, startBank, stopBank } from '../../../../tests/support/bank';
import { startLossyBank } from '../../../../tests/support/network';
import { intentRow } from '../../../../tests/support/db';
import {
  persistIntent,
  toolContextFactory,
  transferInputFactory,
} from '../../../../tests/fixtures/factories';
import { accounts, customers, historicTransfer, unknown } from '../../../../tests/fixtures/world';

const app = wireTransfers();
const authorizeTransfer = app.internals.authorizeTransfer;
const checksOf = (result: unknown) => (result as { checks: PreflightCheck[] }).checks;
const idsOf = (result: unknown) => checksOf(result).map((c) => c.id);
describe('authorizeTransfer', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should propose a transfer from the actor main account for review', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({ fromAccountId: accounts.lucia });
    // Act
    const result = await authorizeTransfer(ctx, transfer);
    // Assert
    assert.equal(result?.status, 'requires_confirmation');
    assert.deepEqual((result?.approval as { payload: unknown }).payload, transfer);
  });
  it('should propose a transfer from any other account the actor holds', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({ fromAccountId: accounts.luciaSavings });
    // Act
    const result = await authorizeTransfer(ctx, transfer);
    // Assert
    assert.equal(result?.status, 'requires_confirmation');
  });
  it('should allow a transfer once its pending proposal is approved', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({ fromAccountId: accounts.lucia });
    const proposal = await authorizeTransfer(ctx, transfer);
    const approvalId = (proposal?.approval as { id: string }).id;
    // Act
    const result = await authorizeTransfer({ ...ctx, approvalId }, transfer);
    // Assert
    assert.equal(result, null);
  });
  it('should reject an approval presented with different transfer details', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({ fromAccountId: accounts.lucia });
    const proposal = await authorizeTransfer(ctx, transfer);
    const approvalId = (proposal?.approval as { id: string }).id;
    // Act & Assert
    await assert.rejects(
      authorizeTransfer(
        { ...ctx, approvalId },
        { ...transfer, amountCents: transfer.amountCents + 1 },
      ),
      (e) => {
        assert.ok(e instanceof DomainError);
        assert.equal(httpStatusOf(e), 409);
        return true;
      },
    );
  });
  it('should reject a source account held by another customer with a 403', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({ fromAccountId: accounts.bruno });
    // Act & Assert
    await assert.rejects(authorizeTransfer(ctx, transfer), (e) => {
      assert.ok(e instanceof DomainError);
      assert.equal(httpStatusOf(e), 403);
      return true;
    });
  });
  it('should reject a source account that does not exist with a 403', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({ fromAccountId: unknown.account });
    // Act & Assert
    await assert.rejects(authorizeTransfer(ctx, transfer), (e) => {
      assert.ok(e instanceof DomainError);
      assert.equal(httpStatusOf(e), 403);
      return true;
    });
  });
});

describe('authorizeTransfer pre-flight checks', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should trust Bruno for Lucía once her historic transfer is reconciled, and report balance and unusual amount', async () => {
    // Arrange: the app seed records the historic EUR 85 transfer to Bruno as failed.
    seedApp();
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({
      fromAccountId: accounts.lucia,
      toAccountId: accounts.bruno,
      amountCents: 20_000,
    });
    // Act
    const result = await authorizeTransfer(ctx, transfer);
    // Assert
    assert.deepEqual(idsOf(result), ['balance_after', 'unusual_amount']);
    assert.equal(intentRow(historicTransfer.intentId)?.status, 'completed');
    assert.deepEqual(
      checksOf(result).map((c) => [c.severity, c.message]),
      [
        ['info', 'After this transfer, your Aurora account will have EUR 3,807.50.'],
        [
          'warning',
          'This is larger than any payment from your accounts in your recent activity (largest EUR 85.00).',
        ],
      ],
    );
  });
  it('should warn Lucía about a recipient she has never paid through the app', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({ toAccountId: accounts.carla });
    // Act
    const result = await authorizeTransfer(ctx, transfer);
    // Assert
    const check = checksOf(result).find((c) => c.id === 'first_time_recipient');
    assert.equal(check?.severity, 'warning');
    assert.match(
      check?.message ?? '',
      /^You have not sent money to Carla .+ through Banana Bank's app before\./,
    );
  });
  it('should persist the checks and return the stored ones when the proposal is reused', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build();
    const first = await authorizeTransfer(ctx, transfer);
    // The balance changes at the bank after the proposal was made.
    await httpTransfersBank.transfer(
      customers.lucia,
      transferInputFactory.build(),
      `ref-${ctx.intentId}`,
    );
    // Act
    const second = await authorizeTransfer(ctx, transfer);
    // Assert
    assert.deepEqual(checksOf(second), checksOf(first));
    const [stored] = app
      .listLiveProposals({ userId: customers.lucia })
      .filter((a) => a.intent_id === ctx.intentId);
    assert.deepEqual(stored.checks, checksOf(first));
  });
  it('should flag a transfer larger than the balance as a blocker and still propose it', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.diego });
    const transfer = transferInputFactory.build({
      fromAccountId: accounts.diego,
      amountCents: 20_000,
    });
    const balance = await balanceOf(accounts.diego);
    // Act
    const result = await authorizeTransfer(ctx, transfer);
    // Assert
    assert.equal(result?.status, 'requires_confirmation');
    const [check] = checksOf(result);
    assert.equal(check.id, 'balance_after');
    assert.equal(check.severity, 'blocker');
    assert.equal(balance, 7_500);
    assert.equal(
      check.message,
      'Your Horizon account has EUR 75.00; this transfer would leave it EUR 125.00 short.',
    );
  });
  it('should still propose the transfer when the movements cannot be loaded, saying so', async () => {
    // Arrange
    const lossy = await startLossyBank((_method, path) => path === '/v1/movements');
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build();
    try {
      // Act
      const result = await authorizeTransfer(ctx, transfer);
      // Assert
      assert.equal(result?.status, 'requires_confirmation');
      assert.ok(lossy.lost >= 1);
      assert.ok(idsOf(result).includes('history_unavailable'));
      assert.equal(idsOf(result).includes('unusual_amount'), false);
    } finally {
      await lossy.close();
    }
  });
  it('should warn about a pending twin the customer chose to send past', async () => {
    // Arrange
    const transfer = transferInputFactory.build();
    const twin = persistIntent({ userId: customers.lucia, payload: transfer, status: 'unknown' });
    const ctx = toolContextFactory.build({
      userId: customers.lucia,
      overridePendingIntentId: twin.id,
    });
    // Act
    const result = await authorizeTransfer(ctx, transfer);
    // Assert
    assert.deepEqual(
      checksOf(result).find((c) => c.id === 'pending_twin'),
      {
        id: 'pending_twin',
        severity: 'warning',
        message: `An identical transfer from ${timeOf(twin.createdAt)} is still being verified with the bank. You chose to send this one anyway; if both complete, you will pay twice.`,
        source: { kind: 'safeguard', id: 'P0-4' },
      },
    );
  });
  it('should confirm a proposal without listing movements or reconciling past transfers', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({ toAccountId: accounts.carla });
    persistIntent({
      userId: customers.lucia,
      payload: transferInputFactory.build({ toAccountId: accounts.carla }),
      status: 'failed',
      bankReference: unknown.reference,
    });
    const proposal = await authorizeTransfer(ctx, transfer);
    const approvalId = (proposal?.approval as { id: string }).id;
    const paths: string[] = [];
    const recording = await startLossyBank((_method, path) => (paths.push(path), false));
    try {
      // Act
      const result = await authorizeTransfer({ ...ctx, approvalId }, transfer);
      // Assert
      assert.equal(result, null);
      assert.deepEqual(
        paths.filter((p) => p === '/v1/movements' || p.startsWith('/v1/operations/')),
        [],
      );
    } finally {
      await recording.close();
    }
  });
});
