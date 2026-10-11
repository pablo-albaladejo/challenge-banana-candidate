import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appDb } from '../../platform/db/db';
import { insertConversation } from './sqlite-conversations.repo';
import { insertMessage, messagesIn } from './sqlite-messages.repo';
import { conversationFactory, messageFactory } from '../../../tests/fixtures/factories';
import { operators } from '../../../tests/fixtures/world';

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
        author_id: null,
      },
    ]);
  });
  it('should read back the operator who wrote a support message', () => {
    // Arrange
    const conversation = conversationFactory.build();
    insertConversation(conversation);
    const message = messageFactory.build({
      conversationId: conversation.id,
      role: 'operator',
      runId: null,
      authorId: operators.marta,
    });
    // Act
    insertMessage(message);
    // Assert
    const [stored] = messagesIn(conversation.id);
    assert.equal(stored.role, 'operator');
    assert.equal(stored.author_id, operators.marta);
    assert.equal(stored.run_id, null);
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
