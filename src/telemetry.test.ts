import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordEvent } from './telemetry';
import { appDb } from './db';
import type { ToolContext } from './types';
type EventRow = {
  id: string;
  run_id: string;
  user_id: string;
  conversation_id: string | null;
  kind: string;
  data: string;
  created_at: string;
};
const events = () => appDb().prepare('SELECT * FROM events').all() as EventRow[];
const context: ToolContext = {
  userId: 'lucia',
  conversationId: 'conv-telemetry',
  runId: 'run-telemetry',
  intentId: 'intent-telemetry',
};
describe('recordEvent', () => {
  beforeEach(() => appDb().exec('DELETE FROM events'));
  it('should store one event tied to the run, user and conversation', () => {
    // Arrange
    const data = { tool: 'list_accounts', status: 'completed' };
    // Act
    recordEvent(context, 'tool', data);
    // Assert
    const rows = events();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].run_id, 'run-telemetry');
    assert.equal(rows[0].user_id, 'lucia');
    assert.equal(rows[0].conversation_id, 'conv-telemetry');
    assert.equal(rows[0].kind, 'tool');
  });
  it('should keep the tool name and status in the event data', () => {
    // Arrange
    const data = { tool: 'transfer_money', status: 'failed' };
    // Act
    recordEvent(context, 'tool', data);
    // Assert
    const stored = JSON.parse(events()[0].data);
    assert.equal(stored.tool, 'transfer_money');
    assert.equal(stored.status, 'failed');
  });
  it('should record events for runs outside a conversation', () => {
    // Arrange
    const standalone = { ...context, conversationId: null };
    // Act
    recordEvent(standalone, 'tool', { tool: 'search_documents', status: 'completed' });
    // Assert
    assert.equal(events()[0].conversation_id, null);
  });
  it('should give each event its own id and an ISO timestamp', () => {
    // Arrange
    const data = { tool: 'list_accounts', status: 'completed' };
    // Act
    recordEvent(context, 'tool', data);
    recordEvent(context, 'tool', data);
    // Assert
    const rows = events();
    assert.equal(new Set(rows.map((r) => r.id)).size, 2);
    assert.ok(rows.every((r) => new Date(r.created_at).toISOString() === r.created_at));
  });
});
