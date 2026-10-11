// The frozen `src/banking/actions` surface: callers of `transferMoney` still catch `HttpError` and
// `BankError`, whatever the use case throws inside.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transferMoney, transferSchema } from './legacy';
import { HttpError } from '../../platform/http/http-error';
import { BankError } from '../../platform/bank/client';
import { resetBank, startBank, stopBank } from '../../../tests/support/bank';
import { toolContextFactory, transferInputFactory } from '../../../tests/fixtures/factories';
import { accounts } from '../../../tests/fixtures/world';

describe('transferMoney', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());

  it('should report a foreign source account as HttpError 403 through the frozen transferMoney', async () => {
    // Arrange
    const ctx = toolContextFactory.build();
    const input = transferInputFactory.build({
      fromAccountId: accounts.bruno,
      toAccountId: accounts.lucia,
    });
    // Act & Assert
    await assert.rejects(transferMoney(ctx, input), (e) => {
      assert.ok(e instanceof HttpError);
      assert.deepEqual(
        [e.status, e.message],
        [403, 'This account does not belong to this person.'],
      );
      return true;
    });
  });

  it("should report a bank failure as BankError with the bank's status through the frozen transferMoney", async () => {
    // Arrange
    const ctx = toolContextFactory.build();
    const input = transferInputFactory.build();
    await stopBank();
    // Act & Assert
    try {
      await assert.rejects(transferMoney(ctx, input), (e) => {
        assert.ok(e instanceof BankError);
        assert.deepEqual([e.status, e.message], [504, 'No response received from the bank.']);
        return true;
      });
    } finally {
      await startBank();
    }
  });
});

describe('transferSchema', () => {
  it('should keep transferSchema rejecting a transfer to the same account', () => {
    // Arrange
    const input = transferInputFactory.build();
    // Act
    const result = transferSchema.safeParse({ ...input, toAccountId: input.fromAccountId });
    // Assert
    assert.equal(result.error?.issues[0].message, 'Source and destination accounts must differ.');
  });
});
