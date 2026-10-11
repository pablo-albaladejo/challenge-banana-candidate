import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { makeListAccounts } from './list-accounts';
import type { AccountsBank } from '../ports/accounts-bank';
import { accountFactory } from '../../../../tests/fixtures/factories';
import { customers } from '../../../../tests/fixtures/world';

describe('listAccounts', () => {
  it("should list the customer's accounts and then the recipients they can pay", async () => {
    // Arrange
    const userId = customers.bruno;
    const calls: string[] = [];
    let answerAccounts!: () => void;
    const bank: AccountsBank = {
      accounts: (id) =>
        new Promise((resolve) => {
          calls.push(`accounts:${id}`);
          answerAccounts = () => resolve([accountFactory.build()]);
        }),
      contacts: async (id) => {
        calls.push(`contacts:${id}`);
        return [];
      },
      movements: async () => assert.fail('listAccounts reads no movements'),
    };
    // Act
    const pending = makeListAccounts({ bank })({ userId });
    await setImmediate();
    const readsBeforeAccountsAnswered = [...calls];
    answerAccounts();
    const result = await pending;
    // Assert
    assert.deepEqual(readsBeforeAccountsAnswered, [`accounts:${userId}`]);
    assert.deepEqual(calls, [`accounts:${userId}`, `contacts:${userId}`]);
    assert.deepEqual(Object.keys(result), ['accounts', 'contacts']);
  });
});
