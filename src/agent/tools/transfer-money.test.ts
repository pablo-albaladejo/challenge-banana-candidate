import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from './registry';
import { seedApp } from '../../seed';
import { bankSnapshot, resetBank, startBank, stopBank } from '../../../tests/support/bank';
import { approvalsFor, intentRow } from '../../../tests/support/db';
import { toolContextFactory, transferInputFactory } from '../../../tests/fixtures/factories';
import { conversations } from '../../../tests/fixtures/world';

describe('runTool', () => {
  before(async () => {
    seedApp();
    await startBank();
  });
  after(stopBank);
  beforeEach(() => resetBank());

  it('should propose the transfer for the customer to confirm without moving money', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build({ conversationId: conversations.luciaWelcome });
    const before = await bankSnapshot();
    // Act
    const result = (await runTool('transfer_money', input, ctx)) as { status: string };
    // Assert
    assert.equal(result.status, 'requires_confirmation');
    assert.equal(intentRow(ctx.intentId)!.status, 'requires_confirmation');
    assert.equal(approvalsFor(ctx.intentId), 1);
    assert.deepEqual(await bankSnapshot(), before);
  });

  it('should reject an override of a pending transfer passed in the tool arguments', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const ctx = toolContextFactory.build({ conversationId: conversations.luciaWelcome });
    // Act
    const result = (await runTool(
      'transfer_money',
      { ...input, overridePendingIntentId: 'intent-chosen-by-model' },
      ctx,
    )) as { status: string };
    // Assert
    assert.equal(result.status, 'failed');
    assert.equal(approvalsFor(ctx.intentId), 0);
  });
});
