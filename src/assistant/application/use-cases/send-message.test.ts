import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { assistant, wireAssistant } from '../../entry-points/dependencies';
import { appDb } from '../../../platform/db/db';
import { seedApp } from '../../../server/seed';
import { ConflictError, DomainError } from '../../../shared/domain/errors';
import { httpStatusOf } from '../../../platform/http/errors';
import { resetBank, startBank, stopBank } from '../../../../tests/support/bank';
import { eventsFor, latestRun, messagesOf, runOf } from '../../../../tests/support/db';
import {
  reply,
  startFakeOpenAI,
  toolCall,
  type FakeOpenAI,
} from '../../../../tests/support/openai';
import { persistIntent, transferInputFactory } from '../../../../tests/fixtures/factories';
import { startLossyBank } from '../../../../tests/support/network';
import { fixedClock, sequentialIds } from '../../../../tests/support/clock';
import { accounts, conversations, customers } from '../../../../tests/fixtures/world';

const conversationId = conversations.luciaWelcome;

describe('sendMessage', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
    await startBank();
  });
  after(async () => {
    await fake.close();
    await stopBank();
  });
  beforeEach(async () => {
    fake.reset();
    seedApp();
    await resetBank();
  });

  it('should mark the run incomplete when the model exhausts its rounds without answering', async () => {
    // Arrange
    fake.script(...Array.from({ length: 7 }, () => toolCall('list_accounts', {})));
    // Act
    const result = await assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'Loop forever',
    });
    // Assert
    const run = runOf(result.runId);
    assert.equal(run.status, 'incomplete');
    assert.match(run.error!, /round limit/i);
    assert.equal(fake.requests.filter((r) => r.path.endsWith('/responses')).length, 7);
    assert.match(result.answer, /could not finish/i);
  });
  it('should report malformed tool arguments to the model instead of running the tool', async () => {
    // Arrange
    fake.script(toolCall('list_accounts', '{not json', 'call-bad'), reply('Let me retry.'));
    // Act
    const result = await assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'Accounts?',
    });
    // Assert
    const second = fake.requests.filter((r) => r.path.endsWith('/responses'))[1];
    const output = second.body.input.find(
      (item: { type?: string; call_id?: string }) =>
        item.type === 'function_call_output' && item.call_id === 'call-bad',
    );
    const parsed = JSON.parse(output.output);
    assert.equal(parsed.status, 'failed');
    assert.match(parsed.error, /not valid JSON/i);
    const kinds = eventsFor(result.runId).map((e) => e.kind);
    assert.ok(!kinds.includes('tool.completed'));
  });
  it('should reject a conversation owned by another customer before storing anything', async () => {
    // Arrange
    const before = appDb().prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    // Act & Assert
    await assert.rejects(
      assistant().sendMessage({ userId: customers.bruno, conversationId, content: 'Hi' }),
      (e) => {
        assert.ok(e instanceof DomainError);
        assert.equal(httpStatusOf(e), 404);
        return true;
      },
    );
    assert.deepEqual(appDb().prepare('SELECT COUNT(*) AS n FROM messages').get(), before);
    assert.equal(fake.requests.length, 0);
  });
  it('should store the user message, the assistant answer and a completed run', async () => {
    // Arrange
    fake.script(reply('Hello Lucia, how can I help?'));
    // Act
    const result = await assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'Hi there',
    });
    // Assert
    assert.equal(result.answer, 'Hello Lucia, how can I help?');
    assert.deepEqual(messagesOf(result.runId), [
      { role: 'user', content: 'Hi there' },
      { role: 'assistant', content: 'Hello Lucia, how can I help?' },
    ]);
    assert.deepEqual(runOf(result.runId), {
      user_id: customers.lucia,
      conversation_id: conversationId,
      status: 'completed',
      error: null,
    });
  });

  it('should send the conversation history ending with the new user message', async () => {
    // Arrange
    fake.script(reply('Done.'));
    // Act
    await assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'What is my balance?',
    });
    // Assert
    const call = fake.requests.find((r) => r.path.endsWith('/responses'))!;
    assert.deepEqual(call.body.input.at(-1), { role: 'user', content: 'What is my balance?' });
    assert.ok(call.body.input.length > 1);
  });

  it('should send the tool definitions with sequential tool calls to the model', async () => {
    // Arrange
    fake.script(reply('Done.'));
    // Act
    await assistant().sendMessage({ userId: customers.lucia, conversationId, content: 'Hello' });
    // Assert
    const call = fake.requests.find((r) => r.path.endsWith('/responses'))!;
    const names = call.body.tools.map((t: { name: string }) => t.name);
    for (const name of ['list_accounts', 'search_documents', 'transfer_money']) {
      assert.ok(names.includes(name), name);
    }
    assert.equal(call.body.parallel_tool_calls, false);
    assert.equal(call.body.store, false);
  });

  it('should retrieve documentation for the message and include it in the instructions', async () => {
    // Arrange
    fake.script(reply('Done.'));
    // Act
    await assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'How do transfers work?',
    });
    // Assert
    const embedding = fake.requests.find((r) => r.path.endsWith('/embeddings'))!;
    assert.deepEqual(embedding.body.input, ['How do transfers work?']);
    const call = fake.requests.find((r) => r.path.endsWith('/responses'))!;
    const documentation = call.body.instructions.split('RETRIEVED DOCUMENTATION:\n')[1];
    const excerpts = documentation
      .split('\n')
      .filter((line: string) => line.startsWith('{'))
      .map((line: string) => JSON.parse(line));
    assert.ok(excerpts.length > 0 && excerpts.length <= 5);
    assert.ok(excerpts.every((e: { documentId: string }) => typeof e.documentId === 'string'));
  });

  it('should execute a requested tool and return its output to the model', async () => {
    // Arrange
    fake.script(toolCall('list_accounts', {}, 'call-accounts'), reply('You have two accounts.'));
    // Act
    const result = await assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'Which accounts do I have?',
    });
    // Assert
    const calls = fake.requests.filter((r) => r.path.endsWith('/responses'));
    assert.equal(calls.length, 2);
    const output = calls[1].body.input.find(
      (item: { type?: string }) => item.type === 'function_call_output',
    );
    assert.equal(output.call_id, 'call-accounts');
    assert.deepEqual(
      JSON.parse(output.output).accounts.map((a: { id: string }) => a.id),
      [accounts.lucia, accounts.luciaSavings],
    );
    assert.equal(result.answer, 'You have two accounts.');
  });

  it('should tell the model when a matching transfer is still being verified with the bank', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const pending = persistIntent({
      status: 'unknown',
      payload: input,
      bankReference: `ref-${faker.string.uuid()}`,
    });
    fake.script(toolCall('transfer_money', input, 'call-held'), reply('It is being verified.'));
    const network = await startLossyBank(
      (method, path) => method === 'GET' && path.startsWith('/v1/operations/'),
    );
    // Act
    try {
      await assistant().sendMessage({
        userId: customers.lucia,
        conversationId,
        content: 'Send it again',
      });
    } finally {
      await network.close();
    }
    // Assert
    const second = fake.requests.filter((r) => r.path.endsWith('/responses'))[1];
    const output = second.body.input.find(
      (item: { type?: string; call_id?: string }) =>
        item.type === 'function_call_output' && item.call_id === 'call-held',
    );
    const parsed = JSON.parse(output.output);
    assert.equal(parsed.status, 'requires_review');
    assert.equal(parsed.pendingIntentId, pending.id);
    assert.match(parsed.error, /still being verified with the bank/);
  });
  it('should record the tool events of the run', async () => {
    // Arrange
    fake.script(toolCall('list_accounts', {}), reply('Done.'));
    // Act
    const result = await assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'Accounts?',
    });
    // Assert
    assert.deepEqual(
      eventsFor(result.runId)
        .map((e) => e.kind)
        .filter((kind) => kind.startsWith('tool.')),
      ['tool.started', 'tool.completed'],
    );
  });

  it('should reject a provider error with a 502 and record the failed run', async () => {
    // Arrange
    const providerError = { status: 429, error: 'Rate limited' };
    fake.script(providerError, providerError, providerError);
    // Act & Assert
    await assert.rejects(
      assistant().sendMessage({ userId: customers.lucia, conversationId, content: 'Hello' }),
      (e) => {
        assert.ok(e instanceof DomainError);
        assert.equal(httpStatusOf(e), 502);
        assert.match(e.message, /AI provider returned 429/);
        return true;
      },
    );
    const { id } = latestRun();
    assert.equal(runOf(id).status, 'failed');
    assert.match(runOf(id).error!, /429/);
    assert.deepEqual(
      messagesOf(id).map((m) => m.role),
      ['user', 'assistant'],
    );
    assert.match(messagesOf(id)[1].content, /could not complete the request/);
  });

  it('should reject a second message while the conversation is still answering', async () => {
    // Arrange
    fake.script(reply('First answer.'));
    const first = assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'First',
    });
    // Act & Assert
    await assert.rejects(
      assistant().sendMessage({ userId: customers.lucia, conversationId, content: 'Second' }),
      (e) => {
        assert.ok(e instanceof DomainError);
        assert.equal(httpStatusOf(e), 409);
        return true;
      },
    );
    assert.equal((await first).answer, 'First answer.');
  });

  it('should name the missing conversation when another customer owns it', async () => {
    // Arrange
    const stranger = customers.bruno;
    // Act & Assert
    await assert.rejects(
      assistant().sendMessage({ userId: stranger, conversationId, content: 'Hi' }),
      (e) => {
        assert.ok(e instanceof DomainError);
        assert.equal(e.message, 'Conversation not found.');
        return true;
      },
    );
  });

  it('should ask to wait for the previous response while the conversation is answering', async () => {
    // Arrange
    fake.script(reply('First answer.'));
    const first = assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'First',
    });
    // Act & Assert
    await assert.rejects(
      assistant().sendMessage({ userId: customers.lucia, conversationId, content: 'Second' }),
      (e) => {
        assert.ok(e instanceof DomainError);
        assert.equal(e.message, 'Wait for the previous response to finish.');
        return true;
      },
    );
    await first;
  });

  it('should accept a new message once the previous one has finished', async () => {
    // Arrange
    fake.script(reply('First answer.'), reply('Second answer.'));
    await assistant().sendMessage({ userId: customers.lucia, conversationId, content: 'First' });
    // Act
    const result = await assistant().sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'Second',
    });
    // Assert
    assert.equal(result.answer, 'Second answer.');
  });
});

describe('sendMessage with a fixed clock', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => {
    fake.reset();
    seedApp();
  });

  it('should stamp the user message and the run with the same clock time', async () => {
    // Arrange
    const clock = fixedClock();
    const app = wireAssistant({ clock, ids: sequentialIds('send') });
    fake.script(reply('Hello Lucia.'));
    // Act
    const result = await app.sendMessage({
      userId: customers.lucia,
      conversationId,
      content: 'Hi',
    });
    // Assert
    assert.equal(result.runId, 'send-1');
    assert.deepEqual(appDb().prepare('SELECT id, started_at FROM runs WHERE id=?').get('send-1'), {
      id: 'send-1',
      started_at: clock.now().toISOString(),
    });
    assert.deepEqual(
      appDb()
        .prepare('SELECT id, role, created_at FROM messages WHERE run_id=? ORDER BY rowid')
        .all('send-1'),
      [
        { id: 'send-2', role: 'user', created_at: clock.now().toISOString() },
        { id: 'send-3', role: 'assistant', created_at: clock.now().toISOString() },
      ],
    );
  });
});

describe('sendMessage conversation lock', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => {
    fake.reset();
    seedApp();
  });

  it("should refuse a message while the graph's lock on the conversation is held", async () => {
    // Arrange
    const app = wireAssistant();
    app.internals.locks.tryAcquire(conversationId);
    const before = appDb().prepare('SELECT COUNT(*) AS n FROM runs').get();
    // Act & Assert
    try {
      await assert.rejects(
        app.sendMessage({ userId: customers.lucia, conversationId, content: 'Hi' }),
        (e) => {
          assert.ok(e instanceof ConflictError);
          assert.equal(e.message, 'Wait for the previous response to finish.');
          return true;
        },
      );
    } finally {
      app.internals.locks.release(conversationId);
    }
    assert.deepEqual(appDb().prepare('SELECT COUNT(*) AS n FROM runs').get(), before);
    assert.equal(fake.requests.length, 0);
  });

  it('should release the lock of a conversation whose answer failed', async () => {
    // Arrange
    const app = wireAssistant();
    const providerError = { status: 429, error: 'Rate limited' };
    fake.script(providerError, providerError, providerError);
    await assert.rejects(
      app.sendMessage({ userId: customers.lucia, conversationId, content: 'Hello' }),
    );
    // Act
    const acquired = app.internals.locks.tryAcquire(conversationId);
    // Assert
    try {
      assert.equal(acquired, true);
    } finally {
      app.internals.locks.release(conversationId);
    }
  });
});
