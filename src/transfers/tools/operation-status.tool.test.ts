import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from '../../assistant';
import { seedApp } from '../../server/seed';
import { resetBank, startBank, stopBank } from '../../../tests/support/bank';
import { toolContextFactory } from '../../../tests/fixtures/factories';
import { conversations, customers, historicTransfer, unknown } from '../../../tests/fixtures/world';
import type { ToolContext } from '../../types';

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

  it('should return the operation of the context user for a known reference', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = (await runTool(
      'operation_status',
      { reference: historicTransfer.reference },
      ctx,
    )) as {
      id: string;
      userId: string;
      amountCents: number;
      status: string;
    };
    // Assert
    assert.equal(result.id, historicTransfer.operationId);
    assert.equal(result.userId, ctx.userId);
    assert.equal(result.amountCents, historicTransfer.amountCents);
    assert.equal(result.status, 'completed');
  });

  it('should report an unknown reference as a failed result', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = (await runTool('operation_status', { reference: unknown.reference }, ctx)) as {
      status: string;
      error: string;
    };
    // Assert
    assert.equal(result.status, 'failed');
    assert.equal(typeof result.error, 'string');
  });

  it("should report another customer's reference as a failed result", async () => {
    // Arrange
    const ctx = context({ userId: customers.bruno, conversationId: conversations.brunoWelcome });
    // Act
    const result = (await runTool(
      'operation_status',
      { reference: historicTransfer.reference },
      ctx,
    )) as {
      status: string;
    };
    // Assert
    assert.equal(result.status, 'failed');
  });
});
