import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { makeGetCustomerOverview } from './get-customer-overview';
import { BankFailure } from '../../../shared/domain/bank-failure';
import type { AccountsBank } from '../ports/accounts-bank';
import type { PendingTransfersQuery } from '../ports/pending-transfers-query';
import { customers } from '../../../../tests/fixtures/world';

/**
 * Stub ports that record each read as `<port>:<userId>`, in call order. `fail` makes one bank read
 * reject; `holdAccounts` keeps the accounts read unanswered until `releaseAccounts()`.
 */
function recordingPorts({
  fail,
  holdAccounts = false,
}: { fail?: keyof AccountsBank; holdAccounts?: boolean } = {}) {
  const calls: string[] = [];
  let releaseAccounts = () => {};
  const held = new Promise<void>((resolve) => (releaseAccounts = resolve));
  const read =
    <T>(name: string, value: T) =>
    async (userId: string) => {
      calls.push(`${name}:${userId}`);
      if (name === 'accounts' && holdAccounts) await held;
      if (name === fail) throw new BankFailure('unreachable', 504, 'No response received.');
      return value;
    };
  const bank: AccountsBank = {
    accounts: read('accounts', []),
    movements: read('movements', []),
    contacts: read('contacts', []),
  };
  const transfers: PendingTransfersQuery = {
    pendingTransfers: read('pendingTransfers', []),
    liveProposals: (userId) => {
      calls.push(`liveProposals:${userId}`);
      return [];
    },
  };
  return { calls, releaseAccounts, overview: makeGetCustomerOverview({ bank, transfers }) };
}

describe('getCustomerOverview', () => {
  for (const name of ['lucia', 'bruno'] as const) {
    it(`should read every section for ${name} only`, async () => {
      // Arrange
      const { calls, overview } = recordingPorts();
      const userId = customers[name];
      // Act
      await overview({ userId });
      // Assert
      assert.deepEqual(calls, [
        `accounts:${userId}`,
        `movements:${userId}`,
        `contacts:${userId}`,
        `pendingTransfers:${userId}`,
        `liveProposals:${userId}`,
      ]);
    });
  }

  it('should start the movements, contacts and pending transfers reads while the accounts are still unanswered', async () => {
    // Arrange
    const { calls, releaseAccounts, overview } = recordingPorts({ holdAccounts: true });
    const userId = customers.lucia;
    // Act
    const pending = overview({ userId });
    await setImmediate();
    const readsWhileAccountsHeld = [...calls];
    releaseAccounts();
    await pending;
    // Assert
    assert.deepEqual(readsWhileAccountsHeld, [
      `accounts:${userId}`,
      `movements:${userId}`,
      `contacts:${userId}`,
      `pendingTransfers:${userId}`,
    ]);
  });

  it('should return the five sections in the dashboard order', async () => {
    // Arrange
    const { overview } = recordingPorts();
    // Act
    const result = await overview({ userId: customers.lucia });
    // Assert
    assert.deepEqual(Object.keys(result), [
      'accounts',
      'movements',
      'contacts',
      'approvals',
      'pendingTransfers',
    ]);
  });

  it('should reject the whole overview when one bank read fails, before reading the proposals', async () => {
    // Arrange
    const { calls, overview } = recordingPorts({ fail: 'movements' });
    // Act & Assert
    await assert.rejects(overview({ userId: customers.lucia }), BankFailure);
    assert.ok(!calls.some((c) => c.startsWith('liveProposals:')));
  });
});
