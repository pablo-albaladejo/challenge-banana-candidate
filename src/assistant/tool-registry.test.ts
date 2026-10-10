import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTool, toolDefinitions } from './tool-registry';
import { seedApp } from '../server/seed';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import { eventsFor } from '../../tests/support/db';
import { toolContextFactory } from '../../tests/fixtures/factories';
import { conversations } from '../../tests/fixtures/world';
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
