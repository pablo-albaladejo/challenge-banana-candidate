import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conversations } from '../../entry-points/dependencies';
import { conversationOf, insertConversation } from '../../infrastructure/sqlite-conversations.repo';
import { appDb } from '../../../platform/db/db';
import { conversationFactory } from '../../../../tests/fixtures/factories';
import { customers } from '../../../../tests/fixtures/world';

describe('titleConversation', () => {
  beforeEach(() => appDb().exec('DELETE FROM messages; DELETE FROM conversations'));

  it('should name an untitled conversation after the first 50 characters of the message', () => {
    // Arrange
    const stored = conversationFactory.build({ title: 'New conversation' });
    insertConversation(stored);
    const command = { conversationId: stored.id, userId: stored.userId };
    const conversation = conversations().getOwnedConversation(command);
    const content = 'Can I raise the daily limit of my debit card before travelling abroad?';
    // Act
    conversations().titleConversation({ conversation, userId: stored.userId, content });
    // Assert
    assert.equal(conversations().getOwnedConversation(command).title, content.slice(0, 50));
  });

  it('should keep the title of a conversation that already has one', () => {
    // Arrange
    const stored = conversationFactory.build({ title: 'Card limit' });
    insertConversation(stored);
    const command = { conversationId: stored.id, userId: stored.userId };
    const conversation = conversations().getOwnedConversation(command);
    // Act
    conversations().titleConversation({
      conversation,
      userId: stored.userId,
      content: 'Another question',
    });
    // Assert
    assert.equal(conversations().getOwnedConversation(command).title, 'Card limit');
  });

  it('should leave the title of another customer conversation as it was', () => {
    // Arrange
    const stored = conversationFactory.build({
      userId: customers.bruno,
      title: 'New conversation',
    });
    insertConversation(stored);
    const conversation = conversationOf(stored.id, customers.bruno)!;
    // Act
    conversations().titleConversation({
      conversation,
      userId: customers.lucia,
      content: 'Rename this conversation',
    });
    // Assert
    assert.equal(conversationOf(stored.id, customers.bruno)?.title, 'New conversation');
  });
});
