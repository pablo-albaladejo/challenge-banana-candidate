import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from '../../assistant';
import { seedApp } from '../../server/seed';
import { resetBank, startBank, stopBank } from '../../../tests/support/bank';
import { toolContextFactory } from '../../../tests/fixtures/factories';
import type { Account, ToolContext } from '../../types';
import { accounts, conversations, customers } from '../../../tests/fixtures/world';

/** A run in lucia's welcome conversation, where a support case can be opened. */
const context = (overrides: Partial<ToolContext> = {}) =>
  toolContextFactory.build({ conversationId: conversations.luciaWelcome, ...overrides });

describe('runTool', () => {
  before(async () => {
    seedApp();
    await startBank();
  });
  after(stopBank);
  beforeEach(() => resetBank());

  it('should list the context user accounts and the available contacts', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = (await runTool('list_accounts', {}, ctx)) as {
      accounts: Account[];
      contacts: { id: string; userId: string }[];
    };
    // Assert
    assert.deepEqual(
      result.accounts.map((a) => a.id),
      [accounts.lucia, accounts.luciaSavings],
    );
    assert.ok(result.contacts.length > 0);
    assert.ok(result.contacts.every((c) => c.userId !== ctx.userId));
  });

  it('should resolve the account holder from the context even when the arguments name another user', async () => {
    // Arrange
    const ctx = context({ userId: customers.bruno, conversationId: conversations.brunoWelcome });
    // Act
    const result = (await runTool('list_accounts', { userId: customers.lucia }, ctx)) as {
      accounts: Account[];
    };
    // Assert
    assert.ok(result.accounts.length > 0);
    assert.ok(result.accounts.every((a) => a.userId === ctx.userId));
  });
});
