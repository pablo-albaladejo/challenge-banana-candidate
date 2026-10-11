import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conversations } from '../../entry-points/dependencies';
import { seedApp } from '../../../server/seed';
import { NotFoundError } from '../../../shared/domain/errors';
import { conversations as seeded, customers } from '../../../../tests/fixtures/world';

describe('getConversationDetail', () => {
  beforeEach(() => seedApp());

  it('should return an owned conversation with its messages in time order', () => {
    // Arrange
    const command = { conversationId: seeded.luciaSupport, userId: customers.lucia };
    // Act
    const detail = conversations().getConversationDetail(command);
    // Assert
    assert.equal(detail.conversation.id, seeded.luciaSupport);
    assert.ok(detail.messages.length > 0);
    assert.ok(detail.messages.every((m) => m.conversation_id === seeded.luciaSupport));
    const times = detail.messages.map((m) => m.created_at);
    assert.deepEqual(times, [...times].sort());
  });

  it('should report a conversation of another customer as not found', () => {
    // Arrange
    const command = { conversationId: seeded.brunoWelcome, userId: customers.lucia };
    // Act & Assert
    assert.throws(
      () => conversations().getConversationDetail(command),
      (e: unknown) => e instanceof NotFoundError && e.message === 'Conversation not found.',
    );
  });
});
