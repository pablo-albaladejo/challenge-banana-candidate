// The frozen `src/agent/{run,tools}` surface: callers of `sendMessage` still catch `HttpError`, and
// `toolDefinitions` stays a plain value identical to the golden definitions.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { sendMessage, toolDefinitions } from './legacy';
import { assistant } from './dependencies';
import { HttpError } from '../../platform/http/http-error';
import { seedApp } from '../../server/seed';
import { reply, startFakeOpenAI, type FakeOpenAI } from '../../../tests/support/openai';
import { goldenToolDefinitions } from '../../../tests/fixtures/tool-definitions';
import { conversations, customers } from '../../../tests/fixtures/world';

describe('sendMessage', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => {
    fake.reset();
    seedApp();
  });

  it('should report a missing conversation as HttpError 404 through the frozen sendMessage', async () => {
    // Arrange
    const conversationId = `conv-${faker.string.uuid()}`;
    // Act & Assert
    await assert.rejects(sendMessage(customers.lucia, conversationId, 'Hi'), (e) => {
      assert.ok(e instanceof HttpError);
      assert.deepEqual([e.status, e.message], [404, 'Conversation not found.']);
      return true;
    });
  });

  it('should share the conversation lock of the assistant singleton through the frozen sendMessage', async () => {
    // Arrange
    const conversationId = conversations.luciaWelcome;
    fake.script(reply('First answer.'));
    const first = sendMessage(customers.lucia, conversationId, 'First');
    // Act & Assert
    await assert.rejects(
      assistant().sendMessage({ userId: customers.lucia, conversationId, content: 'Second' }),
      (e) => {
        assert.equal((e as Error).message, 'Wait for the previous response to finish.');
        return true;
      },
    );
    assert.equal((await first).answer, 'First answer.');
  });
});

describe('toolDefinitions', () => {
  it('should keep the tool definitions identical to the golden ones through the frozen toolDefinitions', () => {
    // Arrange
    const expected = JSON.stringify(goldenToolDefinitions);
    // Act
    const actual = JSON.stringify(toolDefinitions);
    // Assert
    assert.equal(actual, expected);
  });
});
