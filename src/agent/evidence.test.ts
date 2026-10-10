import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { answerWithEvidence } from './evidence';
import { reply, startFakeOpenAI, type FakeOpenAI } from '../../tests/support/openai';
import { searchResultFactory } from '../../tests/fixtures/factories';
import { knowledgeInstructions } from './prompt';
import { config } from '../config';

describe('answerWithEvidence', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());

  it('should return the model answer for the question', async () => {
    // Arrange
    const sources = [searchResultFactory.build()];
    fake.script(reply('Transfers are free.'));
    // Act
    const result = await answerWithEvidence('Are transfers free?', sources);
    // Assert
    assert.equal(result.answer, 'Transfers are free.');
  });

  it('should ground the model on the supplied sources and question', async () => {
    // Arrange
    const source = searchResultFactory.build();
    fake.script(reply('Transfers are free.'));
    // Act
    await answerWithEvidence('Are transfers free?', [source]);
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
          e.documentId === source.documentId && e.text === source.text,
      ),
    );
    assert.equal(fake.requests.filter((r) => r.path.endsWith('/embeddings')).length, 0);
  });

  it('should send the model the request settings of a single grounded answer', async () => {
    // Arrange
    const sources = [searchResultFactory.build()];
    fake.script(reply('Transfers are free.'));
    // Act
    await answerWithEvidence('Are transfers free?', sources);
    // Assert
    const [call] = fake.requests.filter((r) => r.path.endsWith('/responses'));
    const { model, reasoning, max_output_tokens, store, instructions, input, tools } = call.body;
    assert.deepEqual(
      { model, reasoning, max_output_tokens, store, instructions, input, tools },
      {
        model: config.chatModel,
        reasoning: { effort: 'low' },
        max_output_tokens: 1200,
        store: false,
        instructions: knowledgeInstructions(sources),
        input: 'Are transfers free?',
        tools: undefined,
      },
    );
  });
});
