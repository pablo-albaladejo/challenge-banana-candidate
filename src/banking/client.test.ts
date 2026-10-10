import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bankRequest, BankError } from './client';
import { config } from '../config';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import { startLossyBank, type NetworkFault } from '../../tests/support/network';
import { faker } from '@faker-js/faker';
import { transferInputFactory } from '../../tests/fixtures/factories';
import { accounts, customers } from '../../tests/fixtures/world';
import type { Account } from '../types';
/** Reads the actor's accounts through a proxy that spoils the bank's answer with `fault`. */
async function accountsThrough(fault: NetworkFault) {
  const network = await startLossyBank((method, path) => path === '/v1/accounts', fault);
  try {
    return await bankRequest<Account[]>(customers.lucia, '/v1/accounts');
  } finally {
    await network.close();
  }
}
/** The error an unverified, unreadable bank answer must surface as. */
const unreadable = (e: unknown) => {
  assert.ok(e instanceof BankError);
  assert.equal(e.status, 502);
  assert.equal(e.message, 'Unreadable bank response.');
  return true;
};
describe('bankRequest', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should return the actor accounts through a signed request', async () => {
    // Arrange
    const actor = customers.lucia;
    // Act
    const held = await bankRequest<Account[]>(actor, '/v1/accounts');
    // Assert
    assert.deepEqual(
      held.map((a) => a.id),
      [accounts.lucia, accounts.luciaSavings],
    );
    assert.ok(held.every((a) => a.userId === actor));
  });
  it('should surface bank rejections as a BankError with the bank status', async () => {
    // Arrange
    const foreignTransfer = {
      ...transferInputFactory.build({ fromAccountId: accounts.bruno, toAccountId: accounts.lucia }),
      reference: `client-test-${faker.string.uuid()}`,
    };
    // Act & Assert
    await assert.rejects(
      bankRequest(customers.lucia, '/v1/transfers', 'POST', foreignTransfer),
      (e) => {
        assert.ok(e instanceof BankError);
        assert.equal(e.status, 403);
        return true;
      },
    );
  });
  it('should report an unreachable bank as a 504 BankError', async () => {
    // Arrange
    const original = config.bankUrl;
    config.bankUrl = 'http://127.0.0.1:9';
    // Act & Assert
    try {
      await assert.rejects(bankRequest(customers.lucia, '/v1/accounts'), (e) => {
        assert.ok(e instanceof BankError);
        assert.equal(e.status, 504);
        return true;
      });
    } finally {
      config.bankUrl = original;
    }
  });
  it('should report an HTML gateway error page as an unverified 502 BankError', async () => {
    // Arrange
    const fault: NetworkFault = 'html-502';
    // Act & Assert
    await assert.rejects(accountsThrough(fault), unreadable);
  });
  it('should report an empty bank body as an unverified 502 BankError', async () => {
    // Arrange
    const fault: NetworkFault = 'empty';
    // Act & Assert
    await assert.rejects(accountsThrough(fault), unreadable);
  });
  it('should report a body cut off while streaming as an unverified 502 BankError', async () => {
    // Arrange
    const fault: NetworkFault = 'truncated';
    // Act & Assert
    await assert.rejects(accountsThrough(fault), unreadable);
  });
});
