import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bankRequest, BankError } from './client';
import { config } from '../config';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import { faker } from '@faker-js/faker';
import { transferInputFactory } from '../../tests/fixtures/factories';
import { accounts, customers } from '../../tests/fixtures/world';
import type { Account } from '../types';
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
});
