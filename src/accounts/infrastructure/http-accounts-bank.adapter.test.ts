import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { httpAccountsBank } from './http-accounts-bank.adapter';
import { BankFailure } from '../../shared/domain/bank-failure';
import { resetBank, startBank, stopBank } from '../../../tests/support/bank';
import { accounts, customers } from '../../../tests/fixtures/world';

describe('httpAccountsBank', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());

  it('should return the accounts, movements and contacts the bank signs for the actor', async () => {
    // Arrange
    const owned: string[] = [accounts.lucia, accounts.luciaSavings];
    // Act
    const [own, movements, contacts] = await Promise.all([
      httpAccountsBank.accounts(customers.lucia),
      httpAccountsBank.movements(customers.lucia),
      httpAccountsBank.contacts(customers.lucia),
    ]);
    // Assert
    assert.deepEqual(
      own.map((a) => a.id),
      owned,
    );
    assert.ok(movements.length > 0 && movements.every((m) => owned.includes(m.accountId)));
    assert.ok(contacts.length > 0 && contacts.every((c) => c.userId !== customers.lucia));
  });

  it("should translate an unreachable bank into an unreachable BankFailure with the bank's message", async () => {
    // Arrange
    await stopBank();
    // Act & Assert
    try {
      await assert.rejects(httpAccountsBank.accounts(customers.lucia), (e) => {
        assert.ok(e instanceof BankFailure);
        assert.deepEqual(
          [e.reason, e.status, e.message],
          ['unreachable', 504, 'No response received from the bank.'],
        );
        return true;
      });
    } finally {
      await startBank();
    }
  });
});
