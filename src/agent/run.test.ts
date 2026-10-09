import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { answerWithEvidence, sendMessage } from './run';
import { appDb } from '../db';
import { seedApp } from '../seed';
import { HttpError } from '../auth';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import { reply, startFakeOpenAI, toolCall, type FakeOpenAI } from '../../tests/support/openai';
import type { SearchResult } from '../types';

const conversationId = 'conv-lucia-welcome';

const messagesOf = (runId: string) =>
  appDb()
    .prepare('SELECT role,content FROM messages WHERE run_id=? ORDER BY created_at,rowid')
    .all(runId) as { role: string; content: string }[];

const runOf = (runId: string) =>
  appDb()
    .prepare('SELECT user_id,conversation_id,status,error FROM runs WHERE id=?')
    .get(runId) as {
    user_id: string;
    conversation_id: string;
    status: string;
    error: string | null;
  };

const latestRun = () =>
  appDb().prepare('SELECT id FROM runs ORDER BY rowid DESC LIMIT 1').get() as { id: string };

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
    const result = await sendMessage('lucia', conversationId, 'Loop forever');
    // Assert
    const run = runOf(result.runId);
    assert.equal(run.status, 'incomplete');
    assert.match(run.error!, /round limit/i);
    assert.equal(fake.requests.filter((r) => r.path.endsWith('/responses')).length, 7);
    assert.match(result.answer, /could not finish/i);
  });
  it('should store the user message, the assistant answer and a completed run', async () => {
    // Arrange
    fake.script(reply('Hello Lucia, how can I help?'));
    // Act
    const result = await sendMessage('lucia', conversationId, 'Hi there');
    // Assert
    assert.equal(result.answer, 'Hello Lucia, how can I help?');
    assert.deepEqual(messagesOf(result.runId), [
      { role: 'user', content: 'Hi there' },
      { role: 'assistant', content: 'Hello Lucia, how can I help?' },
    ]);
    assert.deepEqual(runOf(result.runId), {
      user_id: 'lucia',
      conversation_id: conversationId,
      status: 'completed',
      error: null,
    });
  });

  it('should send the conversation history ending with the new user message', async () => {
    // Arrange
    fake.script(reply('Done.'));
    // Act
    await sendMessage('lucia', conversationId, 'What is my balance?');
    // Assert
    const call = fake.requests.find((r) => r.path.endsWith('/responses'))!;
    assert.deepEqual(call.body.input.at(-1), { role: 'user', content: 'What is my balance?' });
    assert.ok(call.body.input.length > 1);
  });

  it('should send the tool definitions with sequential tool calls to the model', async () => {
    // Arrange
    fake.script(reply('Done.'));
    // Act
    await sendMessage('lucia', conversationId, 'Hello');
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
    await sendMessage('lucia', conversationId, 'How do transfers work?');
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
    const result = await sendMessage('lucia', conversationId, 'Which accounts do I have?');
    // Assert
    const calls = fake.requests.filter((r) => r.path.endsWith('/responses'));
    assert.equal(calls.length, 2);
    const output = calls[1].body.input.find(
      (item: { type?: string }) => item.type === 'function_call_output',
    );
    assert.equal(output.call_id, 'call-accounts');
    assert.deepEqual(
      JSON.parse(output.output).accounts.map((a: { id: string }) => a.id),
      ['acc-lucia', 'acc-lucia-savings'],
    );
    assert.equal(result.answer, 'You have two accounts.');
  });

  it('should record the tool events of the run', async () => {
    // Arrange
    fake.script(toolCall('list_accounts', {}), reply('Done.'));
    // Act
    const result = await sendMessage('lucia', conversationId, 'Accounts?');
    // Assert
    assert.deepEqual(
      appDb()
        .prepare("SELECT kind FROM events WHERE run_id=? AND kind LIKE 'tool.%' ORDER BY rowid")
        .all(result.runId),
      [{ kind: 'tool.started' }, { kind: 'tool.completed' }],
    );
  });

  it('should reject a provider error with a 502 and record the failed run', async () => {
    // Arrange
    const providerError = { status: 429, error: 'Rate limited' };
    fake.script(providerError, providerError, providerError);
    // Act & Assert
    await assert.rejects(sendMessage('lucia', conversationId, 'Hello'), (e) => {
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
    const first = sendMessage('lucia', conversationId, 'First');
    // Act & Assert
    await assert.rejects(sendMessage('lucia', conversationId, 'Second'), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 409);
      return true;
    });
    assert.equal((await first).answer, 'First answer.');
  });

  it('should accept a new message once the previous one has finished', async () => {
    // Arrange
    fake.script(reply('First answer.'), reply('Second answer.'));
    await sendMessage('lucia', conversationId, 'First');
    // Act
    const result = await sendMessage('lucia', conversationId, 'Second');
    // Assert
    assert.equal(result.answer, 'Second answer.');
  });
});

describe('answerWithEvidence', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());

  const sources: SearchResult[] = [
    {
      id: 'chunk-1',
      documentId: 'doc-fees',
      text: 'Transfers between Banana Bank accounts are free.',
      title: 'Fees',
      version: 2,
      validFrom: '2026-01-01',
      validTo: null,
      audience: 'public',
      score: 0.9,
    },
  ];

  it('should return the model answer for the question', async () => {
    // Arrange
    fake.script(reply('Transfers are free.'));
    // Act
    const result = await answerWithEvidence('Are transfers free?', sources);
    // Assert
    assert.equal(result.answer, 'Transfers are free.');
  });

  it('should ground the model on the supplied sources and question', async () => {
    // Arrange
    fake.script(reply('Transfers are free.'));
    // Act
    await answerWithEvidence('Are transfers free?', sources);
    // Assert
    const [call] = fake.requests.filter((r) => r.path.endsWith('/responses'));
    assert.equal(call.body.input, 'Are transfers free?');
    const excerpts = call.body.instructions
      .split('RETRIEVED DOCUMENTATION:\n')[1]
      .split('\n')
      .map((line: string) => JSON.parse(line));
    assert.ok(
      excerpts.some(
        (e: { documentId: string; text: string }) =>
          e.documentId === 'doc-fees' &&
          e.text === 'Transfers between Banana Bank accounts are free.',
      ),
    );
    assert.equal(fake.requests.filter((r) => r.path.endsWith('/embeddings')).length, 0);
  });
});
