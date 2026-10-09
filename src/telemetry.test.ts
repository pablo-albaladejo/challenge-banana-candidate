import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { recordEvent } from './telemetry';
import { appDb } from './db';
import { events } from '../tests/support/db';
import { eventDataFactory, toolContextFactory } from '../tests/fixtures/factories';
import { conversations } from '../tests/fixtures/world';
describe('recordEvent', () => {
  beforeEach(() => appDb().exec('DELETE FROM events'));
  it('should store one event tied to the run, user and conversation', () => {
    // Arrange
    const context = toolContextFactory.build({ conversationId: conversations.luciaWelcome });
    const data = eventDataFactory.build();
    // Act
    recordEvent(context, 'tool', data);
    // Assert
    const rows = events();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].run_id, context.runId);
    assert.equal(rows[0].user_id, context.userId);
    assert.equal(rows[0].conversation_id, context.conversationId);
    assert.equal(rows[0].kind, 'tool');
  });
  it('should keep the tool name and status in the event data', () => {
    // Arrange
    const context = toolContextFactory.build();
    const data = eventDataFactory.build();
    // Act
    recordEvent(context, 'tool', data);
    // Assert
    const stored = JSON.parse(events()[0].data);
    assert.equal(stored.tool, data.tool);
    assert.equal(stored.status, data.status);
  });
  it('should keep the arguments, output, error and duration of the event', () => {
    // Arrange
    const context = toolContextFactory.build();
    const data = eventDataFactory.build({
      status: 'failed',
      arguments: { amountCents: faker.number.int({ min: 1, max: 5000 }) },
      output: { status: 'failed' },
      error: faker.lorem.sentence(),
      durationMs: faker.number.int({ min: 1, max: 5000 }),
    });
    // Act
    recordEvent(context, 'tool.failed', data);
    // Assert
    assert.deepEqual(JSON.parse(events()[0].data), data);
  });
  it('should record events for runs outside a conversation', () => {
    // Arrange
    const standalone = toolContextFactory.build({ conversationId: null });
    // Act
    recordEvent(standalone, 'tool', eventDataFactory.build());
    // Assert
    assert.equal(events()[0].conversation_id, null);
  });
  it('should give each event its own id and an ISO timestamp', () => {
    // Arrange
    const context = toolContextFactory.build();
    const data = eventDataFactory.build();
    // Act
    recordEvent(context, 'tool', data);
    recordEvent(context, 'tool', data);
    // Assert
    const rows = events();
    assert.equal(new Set(rows.map((r) => r.id)).size, 2);
    assert.ok(rows.every((r) => new Date(r.created_at).toISOString() === r.created_at));
  });
});
