import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from '../../../assistant';
import { seedApp } from '../../../server/seed';
import { resetBank, startBank, stopBank } from '../../../../tests/support/bank';
import { toolContextFactory } from '../../../../tests/fixtures/factories';
import { appDb } from '../../../platform/db/db';
import { cases, conversations, customers } from '../../../../tests/fixtures/world';
import type { ToolContext } from '../../../types';

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

  it('should name the missing conversation before reading the summary', async () => {
    // Arrange
    seedApp();
    const ctx = context({ conversationId: null });
    // Act
    const result = (await runTool('request_human', { summary: '' }, ctx)) as {
      status: string;
      error: string;
    };
    // Assert
    assert.equal(result.status, 'failed');
    assert.match(result.error, /conversation is required/);
  });

  it('should answer with only the case status and its id', async () => {
    // Arrange
    seedApp();
    // Act
    const result = (await runTool('request_human', { summary: 'Help' }, context())) as {
      incidentId: string;
    };
    // Assert
    assert.deepEqual(result, { status: 'open', incidentId: result.incidentId });
  });

  it('should open a new case when the conversation only has a closed one', async () => {
    // Arrange
    seedApp();
    const ctx = context({ conversationId: conversations.luciaGuide });
    // Act
    const result = (await runTool('request_human', { summary: 'Again' }, ctx)) as {
      incidentId: string;
    };
    // Assert
    assert.notEqual(result.incidentId, cases.luciaGuide);
    assert.equal(
      (
        appDb().prepare('SELECT status FROM incidents WHERE id=?').get(result.incidentId) as {
          status: string;
        }
      ).status,
      'open',
    );
  });

  it('should open the case for the customer of the run, whoever that is', async () => {
    // Arrange
    seedApp();
    const ctx = context({ userId: customers.bruno, conversationId: conversations.brunoWelcome });
    // Act
    const result = (await runTool('request_human', { summary: 'Help' }, ctx)) as {
      incidentId: string;
    };
    // Assert
    assert.deepEqual(
      appDb()
        .prepare('SELECT user_id,conversation_id FROM incidents WHERE id=?')
        .get(result.incidentId),
      { user_id: customers.bruno, conversation_id: conversations.brunoWelcome },
    );
  });
});
