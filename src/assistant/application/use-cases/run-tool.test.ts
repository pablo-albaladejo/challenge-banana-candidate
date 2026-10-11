import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wireAssistant } from '../../entry-points/dependencies';
import { seedApp } from '../../../server/seed';
import { resetBank, startBank, stopBank } from '../../../../tests/support/bank';
import { eventsFor } from '../../../../tests/support/db';
import { toolContextFactory, transferInputFactory } from '../../../../tests/fixtures/factories';
import { accounts, conversations, operators, unknown } from '../../../../tests/fixtures/world';
import { appDb } from '../../../platform/db/db';
import type { ToolContext } from '../../../types';
import { fixedClock } from '../../../../tests/support/clock';

const { runTool } = wireAssistant();
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

  it('should reject an unknown tool as a failed result', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = await runTool({ name: 'delete_bank', args: {}, ctx });
    // Assert
    assert.deepEqual(result, { status: 'failed', error: 'Unknown tool.' });
  });

  it('should record started and completed events for a successful tool call', async () => {
    // Arrange
    const ctx = context();
    // Act
    await runTool({ name: 'list_accounts', args: {}, ctx });
    // Assert
    const events = eventsFor(ctx.runId);
    assert.deepEqual(
      events.map((e) => [e.kind, e.data.tool, e.data.status]),
      [
        ['tool.started', 'list_accounts', 'started'],
        ['tool.completed', 'list_accounts', 'completed'],
      ],
    );
  });

  it('should record started and failed events for a failing tool call', async () => {
    // Arrange
    const ctx = context();
    // Act
    await runTool({ name: 'delete_bank', args: {}, ctx });
    // Assert
    const events = eventsFor(ctx.runId);
    assert.deepEqual(
      events.map((e) => [e.kind, e.data.tool, e.data.status]),
      [
        ['tool.started', 'delete_bank', 'started'],
        ['tool.failed', 'delete_bank', 'failed'],
      ],
    );
  });
});

describe('runTool error text', () => {
  before(async () => {
    seedApp();
    await startBank();
  });
  after(stopBank);
  beforeEach(() => resetBank());

  it('should tell an operator calling transfer_money that a customer account is required', async () => {
    // Arrange
    const ctx = context({ userId: operators.marta });
    // Act
    const result = await runTool({
      name: 'transfer_money',
      args: transferInputFactory.build(),
      ctx,
    });
    // Assert
    assert.deepEqual(result, { status: 'failed', error: 'A customer account is required.' });
  });

  it('should name a source account the customer does not own', async () => {
    // Arrange
    const input = transferInputFactory.build({
      fromAccountId: accounts.bruno,
      toAccountId: accounts.lucia,
    });
    // Act
    const result = await runTool({ name: 'transfer_money', args: input, ctx: context() });
    // Assert
    assert.deepEqual(result, {
      status: 'failed',
      error: 'This account does not belong to this person.',
    });
  });

  it('should name a destination account that does not exist', async () => {
    // Arrange
    const input = transferInputFactory.build({ toAccountId: unknown.account });
    // Act
    const result = await runTool({ name: 'transfer_money', args: input, ctx: context() });
    // Assert
    assert.deepEqual(result, {
      status: 'failed',
      error: 'The destination account does not exist.',
    });
  });

  it('should pass the schema validation text through for an invalid amount', async () => {
    // Arrange
    const input = transferInputFactory.build({ amountCents: -1 });
    const expected = `[
  {
    "origin": "number",
    "code": "too_small",
    "minimum": 0,
    "inclusive": false,
    "path": [
      "amountCents"
    ],
    "message": "Too small: expected number to be >0"
  }
]`;
    // Act
    const result = await runTool({ name: 'transfer_money', args: input, ctx: context() });
    // Assert
    assert.deepEqual(result, { status: 'failed', error: expected });
  });

  it('should require a conversation to open a support case', async () => {
    // Arrange
    const ctx = context({ conversationId: null });
    // Act
    const result = await runTool({ name: 'request_human', args: { summary: 'Help' }, ctx });
    // Assert
    assert.deepEqual(result, {
      status: 'failed',
      error: 'A conversation is required to open a case.',
    });
  });

  it('should give the setup hint when search_documents finds no document index', async () => {
    // Arrange
    appDb().exec("DELETE FROM meta WHERE key='index-model'");
    // Act
    let result;
    try {
      result = await runTool({
        name: 'search_documents',
        args: { query: 'card limit' },
        ctx: context(),
      });
    } finally {
      seedApp();
    }
    // Assert
    assert.deepEqual(result, {
      status: 'failed',
      error: 'No document index. Run npm run setup or npm run ingest.',
    });
  });

  it('should pass the bank message through when list_accounts cannot reach the bank', async () => {
    // Arrange
    await stopBank();
    // Act
    let result;
    try {
      result = await runTool({ name: 'list_accounts', args: {}, ctx: context() });
    } finally {
      await startBank();
    }
    // Assert
    assert.deepEqual(result, { status: 'failed', error: 'No response received from the bank.' });
  });

  it('should pass the bank message through when operation_status cannot reach the bank', async () => {
    // Arrange
    await stopBank();
    // Act
    let result;
    try {
      result = await runTool({
        name: 'operation_status',
        args: { reference: unknown.reference },
        ctx: context(),
      });
    } finally {
      await startBank();
    }
    // Assert
    assert.deepEqual(result, { status: 'failed', error: 'No response received from the bank.' });
  });

  it('should pass the bank not-found message through for an unknown operation reference', async () => {
    // Arrange
    const args = { reference: unknown.reference };
    // Act
    const result = await runTool({ name: 'operation_status', args, ctx: context() });
    // Assert
    assert.deepEqual(result, { status: 'failed', error: 'Operation not found.' });
  });

  it('should name an unknown tool in the failed result', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = await runTool({ name: 'close_account', args: {}, ctx });
    // Assert
    assert.deepEqual(result, { status: 'failed', error: 'Unknown tool.' });
  });
});

describe('runTool with a fixed clock', () => {
  before(seedApp);

  it("should time each tool call on the graph's clock", async () => {
    // Arrange
    const clock = fixedClock();
    const ticking = {
      now: () => {
        const now = clock.now();
        clock.advance(5);
        return now;
      },
    };
    const ctx = context();
    // Act
    await wireAssistant({ clock: ticking }).runTool({ name: 'delete_bank', args: {}, ctx });
    // Assert
    assert.deepEqual(
      eventsFor(ctx.runId).map((e) => [e.kind, e.data.durationMs]),
      [
        ['tool.started', undefined],
        ['tool.failed', 5],
      ],
    );
  });
});
