import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddings, createResponse, MissingOpenAIKeyError, openai } from './gateway';
import { reply, startFakeOpenAI, type FakeOpenAI } from '../../tests/support/openai';
describe('openai', () => {
  it('should reject a blank API key with MissingOpenAIKeyError', () => {
    // Arrange
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '   ';
    // Act & Assert
    try {
      assert.throws(() => openai(), MissingOpenAIKeyError);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });
  it('should build a fresh client per call with 2 retries and a 45 s timeout', () => {
    // Arrange
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    // Act
    try {
      const first = openai();
      const second = openai();
      // Assert
      assert.notEqual(first, second);
      assert.equal(first.maxRetries, 2);
      assert.equal(first.timeout, 45000);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });
});
describe('createResponse', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());
  it('should send the request body to the Responses API and return its answer', async () => {
    // Arrange
    fake.script(reply('Hello.'));
    const body = { model: 'test-model', input: 'Hi', store: false };
    // Act
    const response = await createResponse(body);
    // Assert
    assert.equal(response.output_text, 'Hello.');
    assert.deepEqual(
      fake.requests.map((r) => [r.path, r.body]),
      [['/v1/responses', body]],
    );
  });
});
describe('createEmbeddings', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());
  it('should send the request body to the Embeddings API and return its vectors', async () => {
    // Arrange
    const vector = [0.6, 0.8];
    fake.embed('a text', vector);
    const body = {
      model: 'test-embedding',
      input: ['a text'],
      dimensions: 2,
      encoding_format: 'float' as const,
    };
    // Act
    const response = await createEmbeddings(body);
    // Assert
    assert.deepEqual(
      response.data.map((d) => d.embedding),
      [vector],
    );
    assert.deepEqual(
      fake.requests.map((r) => [r.path, r.body]),
      [['/v1/embeddings', body]],
    );
  });
});
