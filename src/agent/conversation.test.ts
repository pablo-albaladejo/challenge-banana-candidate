import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { sendMessage } from './conversation';
import { appDb } from '../db';
import { seedApp } from '../seed';
import { HttpError } from '../auth';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import { eventsFor, latestRun, messagesOf, runOf } from '../../tests/support/db';
import { reply, startFakeOpenAI, toolCall, type FakeOpenAI } from '../../tests/support/openai';
import { persistIntent, transferInputFactory } from '../../tests/fixtures/factories';
import { startLossyBank } from '../../tests/support/network';
import { accounts, conversations, customers } from '../../tests/fixtures/world';

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
    const result = await sendMessage(customers.lucia, conversationId, 'Loop forever');
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
    const result = await sendMessage(customers.lucia, conversationId, 'Accounts?');
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
    await assert.rejects(sendMessage(customers.bruno, conversationId, 'Hi'), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 404);
      return true;
    });
    assert.deepEqual(appDb().prepare('SELECT COUNT(*) AS n FROM messages').get(), before);
    assert.equal(fake.requests.length, 0);
  });
  it('should store the user message, the assistant answer and a completed run', async () => {
    // Arrange
    fake.script(reply('Hello Lucia, how can I help?'));
    // Act
    const result = await sendMessage(customers.lucia, conversationId, 'Hi there');
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
    await sendMessage(customers.lucia, conversationId, 'What is my balance?');
    // Assert
    const call = fake.requests.find((r) => r.path.endsWith('/responses'))!;
    assert.deepEqual(call.body.input.at(-1), { role: 'user', content: 'What is my balance?' });
    assert.ok(call.body.input.length > 1);
  });

  it('should send the tool definitions with sequential tool calls to the model', async () => {
    // Arrange
    fake.script(reply('Done.'));
    // Act
    await sendMessage(customers.lucia, conversationId, 'Hello');
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
    await sendMessage(customers.lucia, conversationId, 'How do transfers work?');
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
    const result = await sendMessage(customers.lucia, conversationId, 'Which accounts do I have?');
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
      await sendMessage(customers.lucia, conversationId, 'Send it again');
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
    const result = await sendMessage(customers.lucia, conversationId, 'Accounts?');
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
    await assert.rejects(sendMessage(customers.lucia, conversationId, 'Hello'), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 502);
      assert.match(e.message, /AI provider returned 429/);
      return true;
    });
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
    const first = sendMessage(customers.lucia, conversationId, 'First');
    // Act & Assert
    await assert.rejects(sendMessage(customers.lucia, conversationId, 'Second'), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 409);
      return true;
    });
    assert.equal((await first).answer, 'First answer.');
  });

  it('should accept a new message once the previous one has finished', async () => {
    // Arrange
    fake.script(reply('First answer.'), reply('Second answer.'));
    await sendMessage(customers.lucia, conversationId, 'First');
    // Act
    const result = await sendMessage(customers.lucia, conversationId, 'Second');
    // Assert
    assert.equal(result.answer, 'Second answer.');
  });
});
