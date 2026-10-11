import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conversations } from '../../entry-points/dependencies';
import { insertConversation } from '../../infrastructure/sqlite-conversations.repo';
import { appDb } from '../../../platform/db/db';
import { conversationFactory } from '../../../../tests/fixtures/factories';
import { customers } from '../../../../tests/fixtures/world';

describe('listConversations', () => {
  beforeEach(() => appDb().exec('DELETE FROM messages; DELETE FROM conversations'));

  it('should list only the conversations of the customer, newest first', () => {
    // Arrange
    const older = conversationFactory.build({ createdAt: '2026-09-01T10:00:00.000Z' });
    const newer = conversationFactory.build({ createdAt: '2026-09-02T10:00:00.000Z' });
    const others = conversationFactory.build({ userId: customers.bruno });
    [older, newer, others].forEach(insertConversation);
    // Act
    const list = conversations().listConversations({ userId: customers.lucia });
    // Assert
    assert.deepEqual(
      list.map((c) => c.id),
      [newer.id, older.id],
    );
  });
});
