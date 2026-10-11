import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wireConversations } from '../../entry-points/dependencies';
import { appDb } from '../../../platform/db/db';
import { fixedClock, sequentialIds } from '../../../../tests/support/clock';
import { customers } from '../../../../tests/fixtures/world';

describe('startConversation with a fixed clock', () => {
  beforeEach(() => appDb().exec('DELETE FROM messages; DELETE FROM conversations'));

  it('should date a new conversation at the clock time', () => {
    // Arrange
    const clock = fixedClock('2026-09-24T09:00:00.000Z');
    const app = wireConversations({ clock, ids: sequentialIds('conv') });
    // Act
    const started = app.startConversation({ userId: customers.lucia });
    // Assert
    assert.deepEqual(started, { id: 'conv-1' });
    assert.deepEqual(app.listConversations({ userId: customers.lucia }), [
      {
        id: 'conv-1',
        user_id: customers.lucia,
        title: 'New conversation',
        created_at: '2026-09-24T09:00:00.000Z',
      },
    ]);
  });
});
