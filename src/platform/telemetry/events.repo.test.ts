import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appDb } from '../db/db';
import { eventsIn, insertEvent } from './events.repo';
import { eventFactory } from '../../../tests/fixtures/factories';

describe('events repository', () => {
  beforeEach(() => appDb().exec('DELETE FROM events'));
  it('should read back a stored event of a conversation', () => {
    // Arrange
    const event = eventFactory.build();
    // Act
    insertEvent(event);
    // Assert
    assert.deepEqual(eventsIn(event.conversationId!), [
      {
        id: event.id,
        run_id: event.runId,
        user_id: event.userId,
        conversation_id: event.conversationId,
        kind: event.kind,
        data: event.data,
        created_at: event.createdAt,
      },
    ]);
  });
  it('should list the events of a conversation in recording order', () => {
    // Arrange
    const createdAt = new Date().toISOString();
    const first = eventFactory.build({ createdAt, id: 'z-first' });
    const second = eventFactory.build({ createdAt, id: 'a-second' });
    insertEvent(first);
    insertEvent(second);
    // Act
    const list = eventsIn(first.conversationId!);
    // Assert
    assert.deepEqual(
      list.map((e) => e.id),
      [first.id, second.id],
    );
  });
});
