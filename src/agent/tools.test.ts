import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTool, toolDefinitions } from './tools';
import { appDb } from '../db';
import { seedApp } from '../seed';
import { allChunks } from '../retrieval/store';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import { eventsFor } from '../../tests/support/db';
import { toolContextFactory } from '../../tests/fixtures/factories';
import {
  accounts,
  conversations,
  customers,
  historicTransfer,
  unknown,
} from '../../tests/fixtures/world';
import type { Account, ToolContext } from '../types';

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
});

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

  it('should return the matching documentation chunk as the top source', async () => {
    // Arrange
    const chunk = allChunks().find((c) => c.audience === 'public')!;
    // Act
    const result = (await runTool('search_documents', { query: chunk.text }, context())) as {
      sources: { id: string; documentId: string; text: string }[];
    };
    // Assert
    assert.equal(result.sources[0].id, chunk.id);
    assert.equal(result.sources[0].documentId, chunk.documentId);
    assert.ok(result.sources.length <= 5);
  });

  it('should restrict customer documentation searches to public sources', async () => {
    // Arrange
    const internal = allChunks().find((c) => c.audience !== 'public')!;
    // Act
    const result = (await runTool('search_documents', { query: internal.text }, context())) as {
      sources: { id: string; audience: string }[];
    };
    // Assert
    assert.ok(result.sources.every((s) => s.audience === 'public'));
    assert.ok(result.sources.every((s) => s.id !== internal.id));
  });

  it('should reject a documentation search without a query as a failed result', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = (await runTool('search_documents', {}, ctx)) as { status: string };
    // Assert
    assert.equal(result.status, 'failed');
  });

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

  it('should open a support case for the conversation of the context user', async () => {
    // Arrange
    seedApp();
    const ctx = context();
    // Act
    const result = (await runTool('request_human', { summary: 'Card blocked' }, ctx)) as {
      status: string;
      incidentId: string;
    };
    // Assert
    assert.equal(result.status, 'open');
    assert.deepEqual(
      appDb()
        .prepare('SELECT user_id,conversation_id,summary,status FROM incidents WHERE id=?')
        .get(result.incidentId),
      {
        user_id: ctx.userId,
        conversation_id: ctx.conversationId,
        summary: 'Card blocked',
        status: 'open',
      },
    );
  });

  it('should reuse the open case when the same conversation asks for a human again', async () => {
    // Arrange
    seedApp();
    const first = (await runTool('request_human', { summary: 'First' }, context())) as {
      incidentId: string;
    };
    // Act
    const second = (await runTool('request_human', { summary: 'Second' }, context())) as {
      status: string;
      incidentId: string;
    };
    // Assert
    assert.equal(second.status, 'open');
    assert.equal(second.incidentId, first.incidentId);
    assert.equal(
      (
        appDb()
          .prepare('SELECT COUNT(*) n FROM incidents WHERE conversation_id=?')
          .get(conversations.luciaWelcome) as { n: number }
      ).n,
      1,
    );
  });

  it('should reject a support request without a conversation as a failed result', async () => {
    // Arrange
    seedApp();
    const ctx = context({ conversationId: null });
    // Act
    const result = (await runTool('request_human', { summary: 'Help' }, ctx)) as {
      status: string;
      error: string;
    };
    // Assert
    assert.equal(result.status, 'failed');
    assert.match(result.error, /conversation is required/);
  });

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
