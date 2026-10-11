import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchDocuments, searchWithMode } from './search';
import { MissingOpenAIKeyError } from './embeddings';
import { allChunks } from './store';
import { seedApp } from '../../server/seed';
import { appDb } from '../../platform/db/db';
import { setGatewayClock } from '../../platform/model/gateway';
import { startFakeOpenAI, type FakeOpenAI } from '../../../tests/support/openai';
import { startFakeClaude, type FakeClaude } from '../../../tests/support/claude-cli';
import { referenceDate } from '../../platform/config';
import type { Chunk } from '../../types';
describe('searchDocuments', () => {
  let fake: FakeOpenAI;
  let publicChunk: Chunk;
  let internalChunk: Chunk;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => {
    seedApp();
    fake.reset();
    const chunks = allChunks();
    const current = chunks.filter((c) => !c.validTo || c.validTo >= referenceDate);
    publicChunk = current.find((c) => c.audience === 'public')!;
    internalChunk = current.find((c) => c.audience === 'internal')!;
  });
  it('should rank first the chunk whose text equals the query without calling the model', async () => {
    // Arrange
    const query = publicChunk.text;
    // Act
    const results = await searchDocuments(query);
    // Assert
    assert.equal(results[0].id, publicChunk.id);
    assert.equal(results[0].documentId, publicChunk.documentId);
    assert.equal(fake.requests.length, 0);
  });
  it('should only return documents valid on the reference date', async () => {
    // Arrange
    const expired = allChunks().find(
      (c) => c.audience === 'public' && c.validTo && c.validTo < referenceDate,
    )!;
    // Act
    const results = await searchDocuments(expired.text);
    // Assert
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => r.validFrom! <= referenceDate));
    assert.ok(results.every((r) => !r.validTo || r.validTo >= referenceDate));
  });
  it('should embed an uncached query once and rank its nearest chunk first', async () => {
    // Arrange
    const query = 'How much does my account cost each month?';
    fake.embed(query, publicChunk.vector!);
    // Act
    const results = await searchDocuments(query);
    // Assert
    assert.equal(results[0].id, publicChunk.id);
    assert.equal(fake.requests.filter((r) => r.path.endsWith('/embeddings')).length, 1);
  });
  it('should keep internal chunks out of customer results', async () => {
    // Arrange
    const query = internalChunk.text;
    // Act
    const results = await searchDocuments(query, 'customer', 20);
    // Assert
    assert.ok(results.every((r) => r.audience === 'public'));
    assert.equal(fake.requests.length, 0);
  });
  it('should show internal chunks to operators', async () => {
    // Arrange
    const query = internalChunk.text;
    // Act
    const results = await searchDocuments(query, 'operator');
    // Assert
    assert.equal(results[0].id, internalChunk.id);
    assert.equal(results[0].audience, 'internal');
    assert.equal(fake.requests.length, 0);
  });
  it('should return at most five results by default', async () => {
    // Arrange
    const query = publicChunk.text;
    // Act
    const results = await searchDocuments(query);
    // Assert
    assert.ok(results.length > 0 && results.length <= 5);
  });
  it('should return at most the requested number of results', async () => {
    // Arrange
    const query = publicChunk.text;
    // Act
    const results = await searchDocuments(query, 'customer', 2);
    // Assert
    assert.equal(results.length, 2);
  });
  it('should order results by descending score', async () => {
    // Arrange
    const query = publicChunk.text;
    // Act
    const results = await searchDocuments(query, 'customer', 10);
    // Assert
    const scores = results.map((r) => r.score);
    assert.deepEqual(
      scores,
      [...scores].sort((a, b) => b - a),
    );
  });
  it('should return passages without their vectors', async () => {
    // Arrange
    const query = publicChunk.text;
    // Act
    const results = await searchDocuments(query);
    // Assert
    assert.ok(results.every((r) => !('vector' in r)));
    assert.ok(results.every((r) => typeof r.text === 'string' && typeof r.score === 'number'));
  });
  it('should reject with a setup hint when there is no index', async () => {
    // Arrange
    appDb().exec("DELETE FROM meta WHERE key='index-model'");
    // Act & Assert
    await assert.rejects(searchDocuments('anything'), /No document index/);
  });
  it('should reject with a re-ingest hint when the index was built with another model', async () => {
    // Arrange
    appDb()
      .prepare("UPDATE meta SET value='another-embedding-model' WHERE key='index-model'")
      .run();
    // Act & Assert
    await assert.rejects(searchDocuments('anything'), /model does not match the index/);
  });
  it('should reject an uncached query with MissingOpenAIKeyError when no key is configured', async () => {
    // Arrange
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    // Act & Assert
    try {
      await assert.rejects(searchDocuments('a question nobody cached'), MissingOpenAIKeyError);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });
  it('should answer a cached query even when no key is configured', async () => {
    // Arrange
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    // Act
    let results;
    try {
      results = await searchDocuments(publicChunk.text);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
    // Assert
    assert.equal(results[0].id, publicChunk.id);
  });
});

describe('searchWithMode', () => {
  let fake: FakeOpenAI;
  let claude: FakeClaude;
  let publicChunk: Chunk;
  let internalChunk: Chunk;
  const quota = { status: 429, code: 'insufficient_quota' };
  before(async () => {
    fake = await startFakeOpenAI();
    claude = startFakeClaude();
  });
  after(async () => {
    await fake.close();
    claude.close();
    process.env.MODEL_PROVIDER = 'openai';
  });
  beforeEach(() => {
    seedApp();
    fake.reset();
    claude.reset();
    setGatewayClock();
    process.env.MODEL_PROVIDER = 'claude-cli';
    const current = allChunks().filter((c) => !c.validTo || c.validTo >= referenceDate);
    publicChunk = current.find((c) => c.audience === 'public')!;
    internalChunk = current.find((c) => c.audience === 'internal')!;
  });

  it('should search lexically without calling any model under the claude-cli provider', async () => {
    // Arrange
    const query = 'How much does the Aurora account cost each month?';
    // Act
    const result = await searchWithMode(query);
    // Assert
    assert.equal(result.mode, 'lexical');
    assert.ok(result.sources.length > 0 && result.sources.length <= 5);
    assert.equal(fake.requests.length, 0);
    assert.equal(claude.calls().length, 0);
  });

  it('should report semantic mode when OpenAI embeds the query', async () => {
    // Arrange
    process.env.MODEL_PROVIDER = 'openai';
    // Act
    const result = await searchWithMode(publicChunk.text);
    // Assert
    assert.equal(result.mode, 'semantic');
    assert.equal(result.sources[0].id, publicChunk.id);
  });

  it('should keep internal chunks out of customer lexical results', async () => {
    // Arrange
    const query = internalChunk.text;
    // Act
    const { sources } = await searchWithMode(query, 'customer', 20);
    // Assert
    assert.ok(sources.length > 0);
    assert.ok(sources.every((r) => r.audience === 'public'));
  });

  it('should show internal chunks to operators in lexical results', async () => {
    // Arrange
    const query = internalChunk.text;
    // Act
    const { sources } = await searchWithMode(query, 'operator', 20);
    // Assert
    assert.ok(sources.some((r) => r.id === internalChunk.id));
  });

  it('should only return lexical results valid on the reference date', async () => {
    // Arrange
    const expired = allChunks().find(
      (c) => c.audience === 'public' && c.validTo && c.validTo < referenceDate,
    )!;
    // Act
    const { sources } = await searchWithMode(expired.text, 'customer', 20);
    // Assert
    assert.ok(sources.length > 0);
    assert.ok(sources.every((r) => r.validFrom! <= referenceDate));
    assert.ok(sources.every((r) => !r.validTo || r.validTo >= referenceDate));
  });

  it('should fall back to lexical search when an auto-mode embedding call is out of quota', async (t) => {
    // Arrange
    t.mock.method(console, 'warn', () => {});
    process.env.MODEL_PROVIDER = 'auto';
    fake.failEmbeddingsAfter(0, quota);
    // Act
    const result = await searchWithMode('a question nobody cached about fees');
    // Assert
    assert.equal(result.mode, 'lexical');
    assert.equal(fake.requests.filter((r) => r.path.endsWith('/embeddings')).length, 1);
  });

  it('should reject an out-of-quota embedding call under forced openai', async () => {
    // Arrange
    process.env.MODEL_PROVIDER = 'openai';
    fake.failEmbeddingsAfter(0, quota);
    // Act & Assert
    await assert.rejects(searchWithMode('a question nobody cached about fees'), { status: 429 });
  });

  it('should still reject with a setup hint when there is no index', async () => {
    // Arrange
    appDb().exec("DELETE FROM meta WHERE key='index-model'");
    // Act & Assert
    await assert.rejects(searchWithMode('anything'), /No document index/);
  });
});
