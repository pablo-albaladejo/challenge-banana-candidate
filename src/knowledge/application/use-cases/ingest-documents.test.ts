import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { knowledge } from '../../entry-points/dependencies';
import { documents, readDocument } from '../../infrastructure/fixture-document-catalog';
import { chunkDocument } from '../../domain/chunker';
import { allChunks } from '../../infrastructure/sqlite-chunk-store';
import { seedApp } from '../../../server/seed';
import { appDb } from '../../../platform/db/db';
import { config } from '../../../platform/config';
import { startFakeOpenAI, type FakeOpenAI } from '../../../../tests/support/openai';
import { counts } from '../../../../tests/fixtures/world';
const embeddingCalls = (fake: FakeOpenAI) =>
  fake.requests.filter((r) => r.path.endsWith('/embeddings'));
describe('ingest', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => {
    seedApp();
    fake.reset();
  });
  it('should replace the index with one chunk per corpus window', async () => {
    // Arrange
    appDb().exec('DELETE FROM embedding_cache');
    const expected = documents()
      .flatMap((doc) => chunkDocument(doc, readDocument(doc)))
      .map((c) => c.id)
      .sort();
    // Act
    const result = await knowledge().ingestDocuments();
    // Assert
    assert.deepEqual(result, {
      documents: counts.documents,
      chunks: expected.length,
      model: config.embeddingModel,
      dimensions: 1536,
    });
    const chunks = allChunks();
    assert.deepEqual(
      chunks.map((c) => c.id),
      expected,
    );
    assert.ok(chunks.every((c) => c.vector?.length === 1536));
  });
  it('should embed every chunk through the model when the cache is empty', async () => {
    // Arrange
    appDb().exec('DELETE FROM embedding_cache');
    // Act
    await knowledge().ingestDocuments();
    // Assert
    const calls = embeddingCalls(fake);
    const inputs = calls.flatMap((r) => r.body.input as string[]);
    assert.deepEqual(new Set(inputs), new Set(allChunks().map((c) => c.text)));
    assert.ok(calls.every((r) => r.body.input.length <= 48));
  });
  it('should reuse cached embeddings when ingesting again', async () => {
    // Arrange
    appDb().exec('DELETE FROM embedding_cache');
    await knowledge().ingestDocuments();
    fake.reset();
    // Act
    await knowledge().ingestDocuments();
    // Assert
    assert.equal(embeddingCalls(fake).length, 0);
  });
  it('should keep the previous index when an embeddings batch fails', async () => {
    // Arrange
    appDb().exec('DELETE FROM embedding_cache');
    const before = allChunks().map((c) => c.id);
    fake.failEmbeddingsAfter(1);
    // Act & Assert
    await assert.rejects(knowledge().ingestDocuments());
    assert.deepEqual(
      allChunks().map((c) => c.id),
      before,
    );
  });
  it('should resume from the batches cached before a failure', async () => {
    // Arrange
    appDb().exec('DELETE FROM embedding_cache');
    fake.failEmbeddingsAfter(1);
    await assert.rejects(knowledge().ingestDocuments());
    const cached = new Set(embeddingCalls(fake)[0].body.input as string[]);
    fake.reset();
    // Act
    await knowledge().ingestDocuments();
    // Assert
    const resent = embeddingCalls(fake).flatMap((r) => r.body.input as string[]);
    assert.ok(resent.length > 0);
    assert.ok(resent.every((text) => !cached.has(text)));
  });
  it('should report progress with the corpus size and completion', async () => {
    // Arrange
    const messages: string[] = [];
    // Act
    const result = await knowledge().ingestDocuments({
      onProgress: (message) => messages.push(message),
    });
    // Assert
    assert.deepEqual(messages, [
      `${counts.documents} documents · ${result.chunks} chunks`,
      'Index updated.',
    ]);
  });
});
