import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { makeGetCustomerOverview } from './get-customer-overview';
import { BankFailure } from '../../../shared/domain/bank-failure';
import type { AccountsBank, Contact } from '../ports/accounts-bank';
import type {
  LiveProposal,
  PendingTransfer,
  PendingTransfersQuery,
} from '../ports/pending-transfers-query';
import { faker } from '@faker-js/faker';
import { accounts as accountIds, customers, unknown } from '../../../../tests/fixtures/world';
import { accountFactory, transferInputFactory } from '../../../../tests/fixtures/factories';
import type { Account } from '../../../types';

/**
 * Stub ports that record each read as `<port>:<userId>`, in call order. `fail` makes one bank read
 * reject; `holdAccounts` keeps the accounts read unanswered until `releaseAccounts()`. `data` sets
 * what the accounts, contacts, pending transfers and live proposals reads answer (empty by default).
 */
function recordingPorts({
  fail,
  holdAccounts = false,
  data = {},
}: {
  fail?: keyof AccountsBank;
  holdAccounts?: boolean;
  data?: {
    accounts?: Account[];
    contacts?: Contact[];
    pending?: PendingTransfer[];
    proposals?: LiveProposal[];
  };
} = {}) {
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
    accounts: read('accounts', data.accounts ?? []),
    movements: read('movements', []),
    contacts: read('contacts', data.contacts ?? []),
  };
  const transfers: PendingTransfersQuery = {
    pendingTransfers: read('pendingTransfers', data.pending ?? []),
    liveProposals: (userId) => {
      calls.push(`liveProposals:${userId}`);
      return data.proposals ?? [];
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

  describe('proposal parties', () => {
    /**
     * Lucia's Aurora and savings accounts, and Bruno's main account as one of her contacts, with
     * IBANs in the bank seed's format, so the masked forms below are literals.
     */
    const world = () => {
      const main = accountFactory.build({ iban: 'ES91 2100 0418 450000000001' });
      const savings = accountFactory.build({
        id: accountIds.luciaSavings,
        label: 'Personal savings',
        iban: 'ES22 2100 0418 460000000001',
      });
      const { id, userId, label } = accountFactory.build({
        id: accountIds.bruno,
        userId: customers.bruno,
      });
      const iban = 'ES91 2100 0418 450000000002';
      const bruno: Contact = { id, userId, label, iban, name: faker.person.fullName() };
      return { main, savings, bruno };
    };
    const proposalOf = (payload = transferInputFactory.build()): LiveProposal => ({
      id: `approval-${faker.string.uuid()}`,
      payload,
    });

    it('should name the source account and the recipient with masked IBANs on each proposal', async () => {
      // Arrange
      const { main, savings, bruno } = world();
      const proposal = proposalOf();
      const { overview } = recordingPorts({
        data: { accounts: [main, savings], contacts: [bruno], proposals: [proposal] },
      });
      // Act
      const { approvals } = await overview({ userId: customers.lucia });
      // Assert
      assert.deepEqual(approvals[0].parties, {
        from: { label: main.label, iban: 'ES91 ···· 0001', own: true },
        to: { holder: bruno.name, label: bruno.label, iban: 'ES91 ···· 0002', own: false },
      });
    });

    it('should never put a full IBAN in the parties', async () => {
      // Arrange
      const { main, savings, bruno } = world();
      const { overview } = recordingPorts({
        data: { accounts: [main, savings], contacts: [bruno], proposals: [proposalOf()] },
      });
      // Act
      const { approvals } = await overview({ userId: customers.lucia });
      // Assert
      const parties = JSON.stringify(approvals[0].parties);
      for (const iban of [main.iban, bruno.iban]) assert.ok(!parties.includes(iban));
    });

    it("should mark a destination among the customer's own accounts as her own", async () => {
      // Arrange
      const { main, savings, bruno } = world();
      const proposal = proposalOf(transferInputFactory.build({ toAccountId: savings.id }));
      const { overview } = recordingPorts({
        data: { accounts: [main, savings], contacts: [bruno], proposals: [proposal] },
      });
      // Act
      const { approvals } = await overview({ userId: customers.lucia });
      // Assert
      assert.deepEqual(approvals[0].parties.to, {
        label: savings.label,
        iban: 'ES22 ···· 0001',
        own: true,
      });
    });

    it('should describe an account the bank does not list as unknown and not found, without its id', async () => {
      // Arrange
      const { main, bruno } = world();
      const proposal = proposalOf(transferInputFactory.build({ toAccountId: unknown.account }));
      const { overview } = recordingPorts({
        data: { accounts: [main], contacts: [bruno], proposals: [proposal] },
      });
      // Act
      const { approvals } = await overview({ userId: customers.lucia });
      // Assert
      assert.deepEqual(approvals[0].parties.to, {
        label: 'Unknown account',
        iban: null,
        own: null,
      });
    });

    it('should name an account whose IBAN is missing or too short to mask, with no IBAN', async () => {
      // Arrange
      const { savings } = world();
      const main = accountFactory.build({ iban: 'ES91' });
      const bruno = { ...world().bruno, iban: undefined } as unknown as Contact;
      const { overview } = recordingPorts({
        data: { accounts: [main, savings], contacts: [bruno], proposals: [proposalOf()] },
      });
      // Act
      const { approvals } = await overview({ userId: customers.lucia });
      // Assert
      assert.deepEqual(
        [approvals[0].parties.from.iban, approvals[0].parties.to.iban],
        [null, null],
      );
    });

    it('should keep the stored payload of each proposal unchanged next to its parties', async () => {
      // Arrange
      const { main, bruno } = world();
      const proposal = proposalOf();
      const { overview } = recordingPorts({
        data: { accounts: [main], contacts: [bruno], proposals: [proposal] },
      });
      // Act
      const { approvals } = await overview({ userId: customers.lucia });
      // Assert
      assert.deepEqual(
        approvals.map((a) => ({ id: a.id, payload: a.payload })),
        [proposal],
      );
    });
  });

  it('should name both parties of each pending transfer from the same accounts and contacts', async () => {
    // Arrange
    const main = accountFactory.build({ iban: 'ES91 2100 0418 450000000001' });
    const { id, userId, label } = accountFactory.build({
      id: accountIds.bruno,
      userId: customers.bruno,
    });
    const bruno: Contact = {
      id,
      userId,
      label,
      iban: 'ES91 2100 0418 450000000002',
      name: faker.person.fullName(),
    };
    const pending: PendingTransfer = {
      id: `intent-${faker.string.uuid()}`,
      status: 'unknown',
      payload: transferInputFactory.build(),
      createdAt: new Date().toISOString(),
    };
    const { overview } = recordingPorts({
      data: { accounts: [main], contacts: [bruno], pending: [pending] },
    });
    // Act
    const { pendingTransfers } = await overview({ userId: customers.lucia });
    // Assert
    assert.deepEqual(pendingTransfers, [
      {
        ...pending,
        parties: {
          from: { label: main.label, iban: 'ES91 ···· 0001', own: true },
          to: { holder: bruno.name, label: bruno.label, iban: 'ES91 ···· 0002', own: false },
        },
      },
    ]);
  });
});
