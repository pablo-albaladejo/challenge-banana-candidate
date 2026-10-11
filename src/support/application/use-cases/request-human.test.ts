import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wireSupport } from '../../entry-points/dependencies';
import { appDb } from '../../../platform/db/db';
import { fixedClock, sequentialIds } from '../../../../tests/support/clock';
import { conversations, customers } from '../../../../tests/fixtures/world';

describe('requestHuman with a fixed clock', () => {
  beforeEach(() => appDb().exec('DELETE FROM incidents'));

  it('should open the incident at the clock time', () => {
    // Arrange
    const clock = fixedClock('2026-09-24T09:00:00.000Z');
    const app = wireSupport({ clock, ids: sequentialIds('case') });
    const command = {
      userId: customers.lucia,
      conversationId: conversations.luciaWelcome,
      summary: 'Card blocked',
    };
    // Act
    const opened = app.requestHuman(command);
    // Assert
    assert.deepEqual(opened, { status: 'open', incidentId: 'case-1' });
    assert.deepEqual(app.listIncidents(), [
      {
        id: 'case-1',
        user_id: customers.lucia,
        conversation_id: conversations.luciaWelcome,
        summary: 'Card blocked',
        status: 'open',
        created_at: '2026-09-24T09:00:00.000Z',
        closed_at: null,
        closed_by: null,
      },
    ]);
  });

  it('should reuse the open incident without a new id or date', () => {
    // Arrange
    const clock = fixedClock('2026-09-24T09:00:00.000Z');
    const app = wireSupport({ clock, ids: sequentialIds('case') });
    const command = {
      userId: customers.lucia,
      conversationId: conversations.luciaWelcome,
      summary: 'Card blocked',
    };
    app.requestHuman(command);
    clock.advance(60_000);
    // Act
    const again = app.requestHuman({ ...command, summary: 'Still blocked' });
    // Assert
    assert.deepEqual(again, { status: 'open', incidentId: 'case-1' });
    assert.equal(app.listIncidents().length, 1);
    assert.equal(app.listIncidents()[0].created_at, '2026-09-24T09:00:00.000Z');
  });
});
