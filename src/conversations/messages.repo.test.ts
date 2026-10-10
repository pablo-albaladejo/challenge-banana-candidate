import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appDb } from '../platform/db/db';
import { insertConversation } from './conversations.repo';
import { insertMessage, messagesIn } from './messages.repo';
import { conversationFactory, messageFactory } from '../../tests/fixtures/factories';

describe('messages repository', () => {
  beforeEach(() => appDb().exec('DELETE FROM messages; DELETE FROM conversations'));
  it('should read back a stored message with its run', () => {
    // Arrange
    const conversation = conversationFactory.build();
    insertConversation(conversation);
    const message = messageFactory.build({ conversationId: conversation.id });
    // Act
    insertMessage(message);
    // Assert
    assert.deepEqual(messagesIn(conversation.id), [
      {
        id: message.id,
        conversation_id: message.conversationId,
        role: message.role,
        content: message.content,
        created_at: message.createdAt,
        run_id: message.runId,
      },
    ]);
  });
  it('should list messages in time order and keep insertion order for equal times', () => {
    // Arrange
    const conversation = conversationFactory.build();
    insertConversation(conversation);
    const createdAt = new Date().toISOString();
    const first = messageFactory.build({
      conversationId: conversation.id,
      createdAt,
      id: 'z-first',
    });
    const second = messageFactory.build({
      conversationId: conversation.id,
      createdAt,
      id: 'a-second',
    });
    insertMessage(first);
    insertMessage(second);
    // Act
    const list = messagesIn(conversation.id);
    // Assert
    assert.deepEqual(
      list.map((m) => m.id),
      [first.id, second.id],
    );
  });
});
