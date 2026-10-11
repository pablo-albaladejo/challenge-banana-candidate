import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wireAssistant } from '../../entry-points/dependencies';
import { maxRounds } from '../../domain/run-policy';
import { seedApp } from '../../../server/seed';
import { resetBank, startBank, stopBank } from '../../../../tests/support/bank';
import { approvalsFor, eventsFor, intentRow } from '../../../../tests/support/db';
import {
  reply,
  startFakeOpenAI,
  toolCall,
  type FakeOpenAI,
} from '../../../../tests/support/openai';
import { toolContextFactory, transferInputFactory } from '../../../../tests/fixtures/factories';
import { conversations } from '../../../../tests/fixtures/world';
import { goldenToolDefinitions } from '../../../../tests/fixtures/tool-definitions';
import { config } from '../../../platform/config';
import { transfers } from '../../../transfers';

const runLoop = wireAssistant().internals.runAgentLoop;
/** A run in lucia's welcome conversation; the loop derives each tool call's intent from it. */
const run = () => {
  const { userId, conversationId, runId } = toolContextFactory.build({
    conversationId: conversations.luciaWelcome,
  });
  return { userId, conversationId: conversationId!, runId };
};
const question = () => [{ role: 'user' as const, content: 'Hello' }];
const responseCalls = (fake: FakeOpenAI) =>
  fake.requests.filter((r) => r.path.endsWith('/responses'));
const outputOf = (fake: FakeOpenAI, round: number, callId: string) =>
  JSON.parse(
    responseCalls(fake)[round].body.input.find(
      (item: { type?: string; call_id?: string }) =>
        item.type === 'function_call_output' && item.call_id === callId,
    ).output,
  );

describe('runLoop', () => {
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

  it('should finish with the text of the first turn that calls no tool', async () => {
    // Arrange
    fake.script(reply('Hello Lucia.'));
    // Act
    const result = await runLoop(run(), 'Be helpful.', question());
    // Assert
    assert.deepEqual(result, { answer: 'Hello Lucia.', finished: true });
    assert.equal(responseCalls(fake).length, 1);
  });

  it('should return an unfinished canned answer once the round limit is reached', async () => {
    // Arrange
    fake.script(...Array.from({ length: maxRounds }, () => toolCall('list_accounts', {})));
    // Act
    const result = await runLoop(run(), 'Be helpful.', question());
    // Assert
    assert.equal(result.finished, false);
    assert.match(result.answer, /could not finish/i);
    assert.equal(responseCalls(fake).length, 7);
  });

  it('should answer malformed tool arguments with a failed output and a tool.failed event', async () => {
    // Arrange
    const current = run();
    fake.script(toolCall('list_accounts', '{not json', 'call-bad'), reply('Let me retry.'));
    // Act
    await runLoop(current, 'Be helpful.', question());
    // Assert
    const output = outputOf(fake, 1, 'call-bad');
    assert.equal(output.status, 'failed');
    assert.match(output.error, /not valid JSON/i);
    assert.deepEqual(
      eventsFor(current.runId).map((e) => [e.kind, e.data.tool]),
      [['tool.failed', 'list_accounts']],
    );
  });

  it('should run each tool call under the intent id of its run and call id', async () => {
    // Arrange
    const current = run();
    fake.script(
      toolCall('transfer_money', transferInputFactory.build(), 'call-transfer'),
      reply('Please confirm it.'),
    );
    // Act
    await runLoop(current, 'Be helpful.', question());
    // Assert
    const intent = intentRow(`${current.runId}:call-transfer`)!;
    assert.equal(intent.status, 'requires_confirmation');
    assert.equal(intent.run_id, current.runId);
    assert.equal(outputOf(fake, 1, 'call-transfer').status, 'requires_confirmation');
  });

  it('should relay the code-written pre-flight checks whatever the model then claims', async () => {
    // Arrange: more than lucia holds, so the checks carry a blocker.
    const current = run();
    const input = transferInputFactory.build({ amountCents: 500_000 });
    fake.script(
      toolCall('transfer_money', input, 'call-transfer'),
      reply('You have plenty of funds for this.'),
    );
    // Act
    const result = await runLoop(current, 'Be helpful.', question());
    // Assert
    const output = outputOf(fake, 1, 'call-transfer');
    const [stored] = transfers()
      .listLiveProposals({ userId: current.userId })
      .filter((a) => a.intent_id === `${current.runId}:call-transfer`);
    assert.equal(result.answer, 'You have plenty of funds for this.');
    assert.equal(output.status, 'requires_confirmation');
    assert.equal(output.checks[0].severity, 'blocker');
    assert.deepEqual(stored.checks, output.checks);
    assert.equal(intentRow(`${current.runId}:call-transfer`)!.status, 'requires_confirmation');
  });

  it('should fail a transfer call whose arguments carry an override', async () => {
    // Arrange
    const current = run();
    const input = transferInputFactory.build();
    fake.script(
      toolCall(
        'transfer_money',
        { ...input, overridePendingIntentId: 'intent-chosen-by-model' },
        'call-x',
      ),
      reply('It is being verified.'),
    );
    // Act
    await runLoop(current, 'Be helpful.', question());
    // Assert
    assert.equal(outputOf(fake, 1, 'call-x').status, 'failed');
    assert.equal(approvalsFor(`${current.runId}:call-x`), 0);
  });

  it('should send the model exactly the tool definitions it received before the registry', async () => {
    // Arrange
    fake.script(reply('Done.'));
    // Act
    await runLoop(run(), 'Be helpful.', question());
    // Assert
    assert.equal(
      JSON.stringify(fake.requests[0].body.tools),
      JSON.stringify(goldenToolDefinitions),
    );
  });

  it('should send the model the request settings, instructions and input of the loop', async () => {
    // Arrange
    fake.script(reply('Done.'));
    const input = question();
    // Act
    await runLoop(run(), 'Be helpful.', input);
    // Assert
    const { model, parallel_tool_calls, reasoning, max_output_tokens, store, include } =
      fake.requests[0].body;
    assert.deepEqual(
      { model, parallel_tool_calls, reasoning, max_output_tokens, store, include },
      {
        model: config.chatModel,
        parallel_tool_calls: false,
        reasoning: { effort: 'low' },
        max_output_tokens: 2000,
        store: false,
        include: ['reasoning.encrypted_content'],
      },
    );
    assert.equal(fake.requests[0].body.instructions, 'Be helpful.');
    assert.deepEqual(fake.requests[0].body.input, [{ role: 'user', content: 'Hello' }]);
  });
});
