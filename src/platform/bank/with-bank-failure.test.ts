import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withBankFailure } from './with-bank-failure';
import { BankError } from './client';
import { BankFailure } from '../../shared/domain/bank-failure';

describe('withBankFailure', () => {
  it('should resolve with the value of a call that succeeds', async () => {
    // Arrange
    const call = Promise.resolve(['acc-1']);
    // Act
    const value = await withBankFailure(call);
    // Assert
    assert.deepEqual(value, ['acc-1']);
  });

  it('should turn a bank client error into a BankFailure with its status and message', async () => {
    // Arrange
    const call = Promise.reject(new BankError(422, 'Insufficient funds.'));
    // Act & Assert
    await assert.rejects(withBankFailure(call), (e) => {
      assert.ok(e instanceof BankFailure);
      assert.deepEqual([e.reason, e.status, e.message], ['rejected', 422, 'Insufficient funds.']);
      return true;
    });
  });

  it('should rethrow any other error unchanged', async () => {
    // Arrange
    const other = new TypeError('not a bank error');
    // Act & Assert
    await assert.rejects(withBankFailure(Promise.reject(other)), (e) => e === other);
  });
});
