import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { authorizeTransfer } from './authorization';
import { HttpError } from '../auth';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import type { ToolContext, TransferInput } from '../types';
const context = (userId: string): ToolContext => ({
  userId,
  conversationId: null,
  runId: `run-${randomUUID()}`,
  intentId: `intent-${randomUUID()}`,
});
const transfer = (fromAccountId: string): TransferInput => ({
  fromAccountId,
  toAccountId: 'acc-carla',
  amountCents: 300,
  concept: 'Gift',
});
describe('authorizeTransfer', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should propose a transfer from the actor main account for review', async () => {
    // Arrange
    const ctx = context('lucia');
    // Act
    const result = await authorizeTransfer(ctx, transfer('acc-lucia'));
    // Assert
    assert.equal(result?.status, 'requires_confirmation');
    assert.deepEqual((result?.approval as { payload: unknown }).payload, transfer('acc-lucia'));
  });
  it('should propose a transfer from any other account the actor holds', async () => {
    // Arrange
    const ctx = context('lucia');
    // Act
    const result = await authorizeTransfer(ctx, transfer('acc-lucia-savings'));
    // Assert
    assert.equal(result?.status, 'requires_confirmation');
  });
  it('should allow a transfer once its pending proposal is approved', async () => {
    // Arrange
    const ctx = context('lucia');
    const proposal = await authorizeTransfer(ctx, transfer('acc-lucia'));
    const approvalId = (proposal?.approval as { id: string }).id;
    // Act
    const result = await authorizeTransfer({ ...ctx, approvalId }, transfer('acc-lucia'));
    // Assert
    assert.equal(result, null);
  });
  it('should reject an approval presented with different transfer details', async () => {
    // Arrange
    const ctx = context('lucia');
    const proposal = await authorizeTransfer(ctx, transfer('acc-lucia'));
    const approvalId = (proposal?.approval as { id: string }).id;
    // Act & Assert
    await assert.rejects(
      authorizeTransfer({ ...ctx, approvalId }, { ...transfer('acc-lucia'), amountCents: 99999 }),
      (e) => {
        assert.ok(e instanceof HttpError);
        assert.equal(e.status, 409);
        return true;
      },
    );
  });
  it('should reject a source account held by another customer with a 403', async () => {
    // Arrange
    const ctx = context('lucia');
    // Act & Assert
    await assert.rejects(authorizeTransfer(ctx, transfer('acc-bruno')), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 403);
      return true;
    });
  });
  it('should reject a source account that does not exist with a 403', async () => {
    // Arrange
    const ctx = context('lucia');
    // Act & Assert
    await assert.rejects(authorizeTransfer(ctx, transfer('acc-missing')), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 403);
      return true;
    });
  });
});
