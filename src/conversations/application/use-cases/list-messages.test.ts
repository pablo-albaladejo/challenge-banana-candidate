import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conversations } from '../../entry-points/dependencies';
import { insertConversation } from '../../infrastructure/sqlite-conversations.repo';
import { appDb } from '../../../platform/db/db';
import { conversationFactory, messageFactory } from '../../../../tests/fixtures/factories';

describe('listMessages', () => {
  beforeEach(() => appDb().exec('DELETE FROM messages; DELETE FROM conversations'));

  it('should list the appended messages of a conversation in the order they were stored', () => {
    // Arrange
    const conversation = conversationFactory.build();
    insertConversation(conversation);
    const createdAt = new Date().toISOString();
    const first = messageFactory.build({ conversationId: conversation.id, createdAt });
    const second = messageFactory.build({ conversationId: conversation.id, createdAt });
    conversations().appendMessage(first);
    conversations().appendMessage(second);
    // Act
    const list = conversations().listMessages({ conversationId: conversation.id });
    // Assert
    assert.deepEqual(
      list.map((m) => [m.id, m.run_id]),
      [
        [first.id, first.runId],
        [second.id, second.runId],
      ],
    );
  });
});
