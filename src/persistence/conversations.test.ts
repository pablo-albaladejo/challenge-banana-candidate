import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { appDb } from '../db';
import {
  conversationOf,
  conversationsOf,
  insertConversation,
  renameConversation,
} from './conversations';
import { conversationFactory } from '../../tests/fixtures/factories';
import { customers } from '../../tests/fixtures/world';

describe('conversations repository', () => {
  beforeEach(() => appDb().exec('DELETE FROM messages; DELETE FROM conversations'));
  it('should read back a stored conversation for its owner', () => {
    // Arrange
    const conversation = conversationFactory.build();
    // Act
    insertConversation(conversation);
    // Assert
    assert.deepEqual(conversationOf(conversation.id, conversation.userId), {
      id: conversation.id,
      user_id: conversation.userId,
      title: conversation.title,
      created_at: conversation.createdAt,
    });
  });
  it('should hide a conversation from another customer', () => {
    // Arrange
    const conversation = conversationFactory.build();
    insertConversation(conversation);
    // Act
    const found = conversationOf(conversation.id, customers.bruno);
    // Assert
    assert.equal(found, undefined);
  });
  it('should list the conversations of a customer newest first', () => {
    // Arrange
    const older = conversationFactory.build({ createdAt: '2026-09-01T10:00:00.000Z' });
    const newer = conversationFactory.build({ createdAt: '2026-09-02T10:00:00.000Z' });
    insertConversation(older);
    insertConversation(newer);
    // Act
    const list = conversationsOf(customers.lucia);
    // Assert
    assert.deepEqual(
      list.map((c) => c.id),
      [newer.id, older.id],
    );
  });
  it('should store the new title of a renamed conversation', () => {
    // Arrange
    const conversation = conversationFactory.build();
    insertConversation(conversation);
    const title = faker.lorem.words(4);
    // Act
    renameConversation(conversation.id, title);
    // Assert
    assert.equal(conversationOf(conversation.id, conversation.userId)?.title, title);
  });
});
