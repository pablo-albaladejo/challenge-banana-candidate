import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTool, toolDefinitions } from './tool-registry';
import { seedApp } from '../server/seed';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import { eventsFor } from '../../tests/support/db';
import { toolContextFactory, transferInputFactory } from '../../tests/fixtures/factories';
import { accounts, conversations, operators, unknown } from '../../tests/fixtures/world';
import { appDb } from '../platform/db/db';
import type { ToolContext } from '../types';
import { goldenToolDefinitions } from '../../tests/fixtures/tool-definitions';

/** A run in lucia's welcome conversation, where a support case can be opened. */
const context = (overrides: Partial<ToolContext> = {}) =>
  toolContextFactory.build({ conversationId: conversations.luciaWelcome, ...overrides });

describe('toolDefinitions', () => {
  it('should expose the core strict agent tools', () => {
    // Arrange
    const expected = [
      'list_accounts',
      'search_documents',
      'transfer_money',
      'operation_status',
      'request_human',
    ];
    // Act
    const names = toolDefinitions.map((t) => t.name);
    // Assert
    assert.ok(expected.every((name) => names.includes(name)));
    assert.ok(toolDefinitions.every((t) => t.strict === true && t.type === 'function'));
  });

  it('should keep the customer identity out of every tool parameter list', () => {
    // Arrange
    const identityFields = ['userId', 'user', 'actor', 'customerId'];
    // Act
    const parameterNames = toolDefinitions.flatMap((t) =>
      Object.keys((t.parameters as { properties: Record<string, unknown> }).properties),
    );
    // Assert
    assert.ok(parameterNames.every((name) => !identityFields.includes(name)));
  });

  it('should serialize exactly as the definitions the model received before the registry', () => {
    // Arrange
    const expected = JSON.stringify(goldenToolDefinitions);
    // Act
    const actual = JSON.stringify(toolDefinitions);
    // Assert
    assert.equal(actual, expected);
  });
});

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
    const result = await runTool('delete_bank', {}, ctx);
    // Assert
    assert.deepEqual(result, { status: 'failed', error: 'Unknown tool.' });
  });

  it('should record started and completed events for a successful tool call', async () => {
    // Arrange
    const ctx = context();
    // Act
    await runTool('list_accounts', {}, ctx);
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
    await runTool('delete_bank', {}, ctx);
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
    const result = await runTool('transfer_money', transferInputFactory.build(), ctx);
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
    const result = await runTool('transfer_money', input, context());
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
    const result = await runTool('transfer_money', input, context());
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
    const result = await runTool('transfer_money', input, context());
    // Assert
    assert.deepEqual(result, { status: 'failed', error: expected });
  });

  it('should require a conversation to open a support case', async () => {
    // Arrange
    const ctx = context({ conversationId: null });
    // Act
    const result = await runTool('request_human', { summary: 'Help' }, ctx);
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
      result = await runTool('search_documents', { query: 'card limit' }, context());
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
      result = await runTool('list_accounts', {}, context());
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
      result = await runTool('operation_status', { reference: unknown.reference }, context());
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
    const result = await runTool('operation_status', args, context());
    // Assert
    assert.deepEqual(result, { status: 'failed', error: 'Operation not found.' });
  });

  it('should name an unknown tool in the failed result', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = await runTool('close_account', {}, ctx);
    // Assert
    assert.deepEqual(result, { status: 'failed', error: 'Unknown tool.' });
  });
});
