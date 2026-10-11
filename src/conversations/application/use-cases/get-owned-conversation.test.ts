import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conversations } from '../../entry-points/dependencies';
import { seedApp } from '../../../server/seed';
import { NotFoundError } from '../../../shared/domain/errors';
import { conversations as seeded, customers, operators } from '../../../../tests/fixtures/world';

const notFound = (e: unknown) =>
  e instanceof NotFoundError && e.message === 'Conversation not found.';

describe('getOwnedConversation', () => {
  beforeEach(() => seedApp());

  it('should return the conversation to its owner', () => {
    // Arrange
    const command = { conversationId: seeded.luciaWelcome, userId: customers.lucia };
    // Act
    const conversation = conversations().getOwnedConversation(command);
    // Assert
    assert.equal(conversation.id, seeded.luciaWelcome);
    assert.equal(conversation.user_id, customers.lucia);
  });

  it('should report a conversation of another customer as not found', () => {
    // Arrange
    const command = { conversationId: seeded.brunoWelcome, userId: customers.lucia };
    // Act & Assert
    assert.throws(() => conversations().getOwnedConversation(command), notFound);
  });

  it('should report a customer conversation to an operator as not found', () => {
    // Arrange
    const command = { conversationId: seeded.luciaWelcome, userId: operators.marta };
    // Act & Assert
    assert.throws(() => conversations().getOwnedConversation(command), notFound);
  });
});
