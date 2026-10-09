import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeTransfer } from './authorization';
import { HttpError } from '../auth';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import { toolContextFactory, transferInputFactory } from '../../tests/fixtures/factories';
import { accounts, customers, unknown } from '../../tests/fixtures/world';
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
        assert.ok(e instanceof HttpError);
        assert.equal(e.status, 409);
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
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 403);
      return true;
    });
  });
  it('should reject a source account that does not exist with a 403', async () => {
    // Arrange
    const ctx = toolContextFactory.build({ userId: customers.lucia });
    const transfer = transferInputFactory.build({ fromAccountId: unknown.account });
    // Act & Assert
    await assert.rejects(authorizeTransfer(ctx, transfer), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 403);
      return true;
    });
  });
});
