import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openaiModel } from './openai-model.adapter';
import { reply, startFakeOpenAI, toolCall, type FakeOpenAI } from '../../../tests/support/openai';
import { goldenToolDefinitions } from '../../../tests/fixtures/tool-definitions';
import { config } from '../../platform/config';
import type { FunctionTool } from 'openai/resources/responses/responses';

describe('openaiModel', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());

  it("should send the agent turn body with today's fields in today's order", async () => {
    // Arrange
    fake.script(reply('Done.'));
    const tools = goldenToolDefinitions as unknown as FunctionTool[];
    const input = [{ role: 'user' as const, content: 'Hello' }];
    // Act
    await openaiModel.agentTurn({ instructions: 'Be helpful.', input, tools });
    // Assert
    assert.equal(
      JSON.stringify(fake.requests[0].body),
      JSON.stringify({
        model: config.chatModel,
        instructions: 'Be helpful.',
        input: [{ role: 'user', content: 'Hello' }],
        tools: goldenToolDefinitions,
        parallel_tool_calls: false,
        reasoning: { effort: 'low' },
        max_output_tokens: 2000,
        store: false,
        include: ['reasoning.encrypted_content'],
      }),
    );
  });

  it('should return the tool calls of a turn and its output as input items', async () => {
    // Arrange
    fake.script(toolCall('list_accounts', {}, 'call-1'));
    // Act
    const turn = await openaiModel.agentTurn({ instructions: 'x', input: [], tools: [] });
    // Assert
    assert.deepEqual(
      [turn.calls.map((c) => c.call_id), turn.items.length, turn.text],
      [['call-1'], 1, ''],
    );
  });

  it("should send the evidence answer body with today's fields in today's order", async () => {
    // Arrange
    fake.script(reply('Transfers are free.'));
    // Act
    const result = await openaiModel.evidenceAnswer({
      instructions: 'Use the sources.',
      question: 'Are transfers free?',
    });
    // Assert
    assert.equal(
      JSON.stringify(fake.requests[0].body),
      JSON.stringify({
        model: config.chatModel,
        instructions: 'Use the sources.',
        input: 'Are transfers free?',
        reasoning: { effort: 'low' },
        max_output_tokens: 1200,
        store: false,
      }),
    );
    assert.equal(result.answer, 'Transfers are free.');
  });
});
