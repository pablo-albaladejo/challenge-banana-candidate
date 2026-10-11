import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { knowledge } from '../../entry-points/dependencies';
import { makeSearchDocuments } from './search-documents';
import { MissingOpenAIKeyError } from '../../infrastructure/cached-openai-embedder';
import { allChunks, replaceChunks } from '../../infrastructure/sqlite-chunk-store';
import { seedApp } from '../../../server/seed';
import { appDb } from '../../../platform/db/db';
import { setGatewayClock } from '../../../platform/model/gateway';
import { startFakeOpenAI, type FakeOpenAI } from '../../../../tests/support/openai';
import { startFakeClaude, type FakeClaude } from '../../../../tests/support/claude-cli';
import { config, referenceDate } from '../../../platform/config';
import { chunkFactory, searchResultFactory } from '../../../../tests/fixtures/factories';
import type { Embedder } from '../ports/embedder';
import type { Chunk } from '../../../types';
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
    const results = (await knowledge().searchDocuments({ query, role: 'customer' })).sources;
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
    const results = (await knowledge().searchDocuments({ query: expired.text, role: 'customer' }))
      .sources;
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
    const results = (await knowledge().searchDocuments({ query, role: 'customer' })).sources;
    // Assert
    assert.equal(results[0].id, publicChunk.id);
    assert.equal(fake.requests.filter((r) => r.path.endsWith('/embeddings')).length, 1);
  });
  it('should keep internal chunks out of customer results', async () => {
    // Arrange
    const query = internalChunk.text;
    // Act
    const results = (await knowledge().searchDocuments({ query, role: 'customer', limit: 20 }))
      .sources;
    // Assert
    assert.ok(results.every((r) => r.audience === 'public'));
    assert.equal(fake.requests.length, 0);
  });
  it('should show internal chunks to operators', async () => {
    // Arrange
    const query = internalChunk.text;
    // Act
    const results = (await knowledge().searchDocuments({ query, role: 'operator' })).sources;
    // Assert
    assert.equal(results[0].id, internalChunk.id);
    assert.equal(results[0].audience, 'internal');
    assert.equal(fake.requests.length, 0);
  });
  it('should return at most five results by default', async () => {
    // Arrange
    const query = publicChunk.text;
    // Act
    const results = (await knowledge().searchDocuments({ query, role: 'customer' })).sources;
    // Assert
    assert.ok(results.length > 0 && results.length <= 5);
  });
  it('should return at most the requested number of results', async () => {
    // Arrange
    const query = publicChunk.text;
    // Act
    const results = (await knowledge().searchDocuments({ query, role: 'customer', limit: 2 }))
      .sources;
    // Assert
    assert.equal(results.length, 2);
  });
  it('should order results by descending score', async () => {
    // Arrange
    const query = publicChunk.text;
    // Act
    const results = (await knowledge().searchDocuments({ query, role: 'customer', limit: 10 }))
      .sources;
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
    const results = (await knowledge().searchDocuments({ query, role: 'customer' })).sources;
    // Assert
    assert.ok(results.every((r) => !('vector' in r)));
    assert.ok(results.every((r) => typeof r.text === 'string' && typeof r.score === 'number'));
  });
  it('should reject with a setup hint when there is no index', async () => {
    // Arrange
    appDb().exec("DELETE FROM meta WHERE key='index-model'");
    // Act & Assert
    await assert.rejects(
      knowledge().searchDocuments({ query: 'anything', role: 'customer' }),
      /No document index/,
    );
  });
  it('should reject with a re-ingest hint when the index was built with another model', async () => {
    // Arrange
    appDb()
      .prepare("UPDATE meta SET value='another-embedding-model' WHERE key='index-model'")
      .run();
    // Act & Assert
    await assert.rejects(
      knowledge().searchDocuments({ query: 'anything', role: 'customer' }),
      /model does not match the index/,
    );
  });
  it('should reject an index whose vectors have other dimensions than the query', async () => {
    // Arrange
    replaceChunks([chunkFactory.build({ audience: 'public' }, { dimensions: 2 })], {
      model: config.embeddingModel,
      dimensions: 2,
    });
    // Act & Assert
    await assert.rejects(
      knowledge().searchDocuments({ query: publicChunk.text, role: 'customer' }),
      {
        message: 'Incompatible embedding dimensions.',
      },
    );
  });

  it('should reject an uncached query with MissingOpenAIKeyError when no key is configured', async () => {
    // Arrange
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    // Act & Assert
    try {
      await assert.rejects(
        knowledge().searchDocuments({ query: 'a question nobody cached', role: 'customer' }),
        MissingOpenAIKeyError,
      );
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
      results = (await knowledge().searchDocuments({ query: publicChunk.text, role: 'customer' }))
        .sources;
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
    // Assert
    assert.equal(results[0].id, publicChunk.id);
  });
});

describe('searchDocuments retrieval mode', () => {
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
    const result = await knowledge().searchDocuments({ query, role: 'customer' });
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
    const result = await knowledge().searchDocuments({ query: publicChunk.text, role: 'customer' });
    // Assert
    assert.equal(result.mode, 'semantic');
    assert.equal(result.sources[0].id, publicChunk.id);
  });

  it('should keep internal chunks out of customer lexical results', async () => {
    // Arrange
    const query = internalChunk.text;
    // Act
    const { sources } = await knowledge().searchDocuments({ query, role: 'customer', limit: 20 });
    // Assert
    assert.ok(sources.length > 0);
    assert.ok(sources.every((r) => r.audience === 'public'));
  });

  it('should show internal chunks to operators in lexical results', async () => {
    // Arrange
    const query = internalChunk.text;
    // Act
    const { sources } = await knowledge().searchDocuments({ query, role: 'operator', limit: 20 });
    // Assert
    assert.ok(sources.some((r) => r.id === internalChunk.id));
  });

  it('should only return lexical results valid on the reference date', async () => {
    // Arrange
    const expired = allChunks().find(
      (c) => c.audience === 'public' && c.validTo && c.validTo < referenceDate,
    )!;
    // Act
    const { sources } = await knowledge().searchDocuments({
      query: expired.text,
      role: 'customer',
      limit: 20,
    });
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
    const result = await knowledge().searchDocuments({
      query: 'a question nobody cached about fees',
      role: 'customer',
    });
    // Assert
    assert.equal(result.mode, 'lexical');
    assert.equal(fake.requests.filter((r) => r.path.endsWith('/embeddings')).length, 1);
  });

  it('should reject an out-of-quota embedding call under forced openai', async () => {
    // Arrange
    process.env.MODEL_PROVIDER = 'openai';
    fake.failEmbeddingsAfter(0, quota);
    // Act & Assert
    await assert.rejects(
      knowledge().searchDocuments({
        query: 'a question nobody cached about fees',
        role: 'customer',
      }),
      { status: 429 },
    );
  });

  it('should search lexically under claude-cli even when the index was built with another model', async () => {
    // Arrange
    appDb()
      .prepare("UPDATE meta SET value='another-embedding-model' WHERE key='index-model'")
      .run();
    // Act
    const result = await knowledge().searchDocuments({ query: publicChunk.text, role: 'customer' });
    // Assert
    assert.equal(result.mode, 'lexical');
    assert.ok(result.sources.some((r) => r.id === publicChunk.id));
  });

  it('should still reject with a setup hint when there is no index', async () => {
    // Arrange
    appDb().exec("DELETE FROM meta WHERE key='index-model'");
    // Act & Assert
    await assert.rejects(
      knowledge().searchDocuments({ query: 'anything', role: 'customer' }),
      /No document index/,
    );
  });
});

describe('makeSearchDocuments', () => {
  /** The use case over stub ports: one indexed chunk, one lexical hit, a scripted embedder. */
  const searchWith = (embedder: Embedder) => {
    const indexed = chunkFactory.build({ vector: [1, 0] });
    const hit = searchResultFactory.build();
    const search = makeSearchDocuments({
      chunks: {
        all: () => [indexed],
        indexModel: () => 'stub-model',
        count: () => ({ chunks: 1 }),
        replace: () => {},
      },
      lexical: { search: () => [hit] },
      embedder,
      settings: { embeddingModel: 'stub-model' },
    });
    return { search, indexed, hit };
  };

  it('should rank the indexed chunks semantically when the embedder answers', async () => {
    // Arrange
    const { search, indexed } = searchWith({
      available: async () => true,
      embed: async () => [[1, 0]],
      fallsBackOn: async () => false,
    });
    // Act
    const result = await search({ query: 'fees', role: 'customer' });
    // Assert
    assert.equal(result.mode, 'semantic');
    assert.deepEqual(
      result.sources.map((s) => [s.id, s.score]),
      [[indexed.id, 1]],
    );
  });

  it('should answer lexically without embedding when the embedder is unavailable', async () => {
    // Arrange
    let embedded = false;
    const { search, hit } = searchWith({
      available: async () => false,
      embed: async () => {
        embedded = true;
        return [[1, 0]];
      },
      fallsBackOn: async () => false,
    });
    // Act
    const result = await search({ query: 'fees', role: 'customer' });
    // Assert
    assert.deepEqual(result, { mode: 'lexical', sources: [hit] });
    assert.equal(embedded, false);
  });

  it('should answer lexically when a failed embedding call may fall back', async () => {
    // Arrange
    const { search, hit } = searchWith({
      available: async () => true,
      embed: async () => {
        throw new Error('quota');
      },
      fallsBackOn: async () => true,
    });
    // Act
    const result = await search({ query: 'fees', role: 'customer' });
    // Assert
    assert.deepEqual(result, { mode: 'lexical', sources: [hit] });
  });
});
