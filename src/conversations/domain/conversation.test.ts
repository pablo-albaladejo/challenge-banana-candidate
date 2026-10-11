import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NEW_CONVERSATION_TITLE, requireOwned, titleFor } from './conversation';
import { NotFoundError } from '../../shared/domain/errors';

describe('titleFor', () => {
  it('should title an untitled conversation from the first 50 characters', () => {
    // Arrange
    const content = 'How do I dispute a card payment I do not recognise from last week?';
    // Act
    const title = titleFor({ title: NEW_CONVERSATION_TITLE }, content);
    // Assert
    assert.equal(title, content.slice(0, 50));
  });

  it('should keep an existing title', () => {
    // Arrange
    const conversation = { title: 'Card limit' };
    // Act
    const title = titleFor(conversation, 'Another question');
    // Assert
    assert.equal(title, undefined);
  });
});

describe('requireOwned', () => {
  it('should report a conversation the user does not own as not found', () => {
    // Arrange
    const notOwned = undefined;
    // Act & Assert
    assert.throws(
      () => requireOwned(notOwned),
      (e: unknown) => e instanceof NotFoundError && e.message === 'Conversation not found.',
    );
  });

  it('should return the owned conversation', () => {
    // Arrange
    const conversation = { id: 'conv-1' };
    // Act
    const owned = requireOwned(conversation);
    // Assert
    assert.equal(owned, conversation);
  });
});
