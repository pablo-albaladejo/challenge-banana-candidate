import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dimensions, embeddingKey, embedTexts, readVector, vectorBuffer } from './embeddings';
import { appDb } from '../db';
import { config } from '../config';
import { fakeEmbedding, startFakeOpenAI, type FakeOpenAI } from '../../tests/support/openai';
const embeddingCalls = (fake: FakeOpenAI) =>
  fake.requests.filter((r) => r.path.endsWith('/embeddings'));
const cacheSize = () =>
  (appDb().prepare('SELECT COUNT(*) n FROM embedding_cache').get() as { n: number }).n;
describe('vectorBuffer', () => {
  it('should encode a vector as 4-byte float32 values', () => {
    // Arrange
    const vector = [0.5, -1.25, 3];
    // Act
    const buffer = vectorBuffer(vector);
    // Assert
    assert.equal(buffer.byteLength, 12);
    assert.equal(buffer.readFloatLE(4), -1.25);
  });
});
describe('readVector', () => {
  it('should decode exactly what vectorBuffer encoded', () => {
    // Arrange
    const vector = [0.5, -1.25, 3, 0];
    // Act
    const decoded = readVector(vectorBuffer(vector));
    // Assert
    assert.deepEqual(decoded, vector);
  });
  it('should read only its own bytes from a buffer view into a larger allocation', () => {
    // Arrange
    const whole = Buffer.concat([
      vectorBuffer([9, 9]),
      vectorBuffer([1.5, 2.5]),
      vectorBuffer([7]),
    ]);
    const view = whole.subarray(8, 16);
    // Act
    const decoded = readVector(view);
    // Assert
    assert.deepEqual(decoded, [1.5, 2.5]);
  });
});
describe('embeddingKey', () => {
  it('should return the same sha256 hex key for the same text', () => {
    // Arrange
    const text = 'What is the Aurora fee?';
    // Act
    const first = embeddingKey(text);
    const second = embeddingKey(text);
    // Assert
    assert.equal(second, first);
    assert.match(first, /^[0-9a-f]{64}$/);
  });
  it('should return different keys for different texts', () => {
    // Arrange
    // Act
    const a = embeddingKey('aurora');
    const b = embeddingKey('cloud');
    // Assert
    assert.notEqual(a, b);
  });
  it('should change the key when the embedding model changes', () => {
    // Arrange
    const original = config.embeddingModel;
    const previous = embeddingKey('aurora');
    // Act
    config.embeddingModel = 'another-embedding-model';
    let changed: string;
    try {
      changed = embeddingKey('aurora');
    } finally {
      config.embeddingModel = original;
    }
    // Assert
    assert.notEqual(changed, previous);
  });
});
describe('embedTexts', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => {
    fake.reset();
    appDb().exec('DELETE FROM embedding_cache');
  });
  it('should return a cached vector without calling the model', async () => {
    // Arrange
    const vector = fakeEmbedding('cached', dimensions);
    appDb()
      .prepare('INSERT INTO embedding_cache(key,vector) VALUES(?,?)')
      .run(embeddingKey('cached text'), vectorBuffer(vector));
    // Act
    const [result] = await embedTexts(['cached text']);
    // Assert
    assert.deepEqual(result, readVector(vectorBuffer(vector)));
    assert.equal(embeddingCalls(fake).length, 0);
  });
  it('should call the model once for an uncached text and cache the vector', async () => {
    // Arrange
    const text = 'a brand new question';
    // Act
    const [first] = await embedTexts([text]);
    const [second] = await embedTexts([text]);
    // Assert
    assert.equal(embeddingCalls(fake).length, 1);
    assert.equal(first.length, dimensions);
    assert.deepEqual(second, readVector(vectorBuffer(first)));
    assert.equal(cacheSize(), 1);
  });
  it('should request the configured model and dimensions', async () => {
    // Arrange
    const text = 'model settings';
    // Act
    await embedTexts([text]);
    // Assert
    const [request] = embeddingCalls(fake);
    assert.equal(request.body.model, config.embeddingModel);
    assert.equal(request.body.dimensions, dimensions);
    assert.deepEqual(request.body.input, [text]);
  });
  it('should return vectors in input order when cached and uncached texts are mixed', async () => {
    // Arrange
    const cached = fakeEmbedding('seeded', dimensions);
    appDb()
      .prepare('INSERT INTO embedding_cache(key,vector) VALUES(?,?)')
      .run(embeddingKey('second'), vectorBuffer(cached));
    fake.embed('first', fakeEmbedding('one', dimensions));
    fake.embed('third', fakeEmbedding('three', dimensions));
    // Act
    const result = await embedTexts(['first', 'second', 'third']);
    // Assert
    assert.deepEqual(result[0], fakeEmbedding('one', dimensions));
    assert.deepEqual(result[1], readVector(vectorBuffer(cached)));
    assert.deepEqual(result[2], fakeEmbedding('three', dimensions));
    assert.deepEqual(embeddingCalls(fake)[0].body.input, ['first', 'third']);
  });
  it('should send uncached texts in batches of 48', async () => {
    // Arrange
    const texts = Array.from({ length: 50 }, (_, i) => `batched text ${i}`);
    // Act
    const result = await embedTexts(texts);
    // Assert
    const calls = embeddingCalls(fake);
    assert.equal(result.length, 50);
    assert.deepEqual(
      calls.map((c) => c.body.input.length),
      [48, 2],
    );
  });
  it('should reject vectors with unexpected dimensions from the model', async () => {
    // Arrange
    fake.embed('short vector', [0.1, 0.2, 0.3]);
    // Act & Assert
    await assert.rejects(embedTexts(['short vector']), /Unexpected dimensions/);
  });
});
