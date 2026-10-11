// The frozen `src/ingestion/pipeline` surface: `scripts/ingest.ts` and external callers keep the
// positional `ingest(onProgress)` and the plain manifest readers.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { documents, ingest, readDocument } from './legacy';
import { seedApp } from '../../server/seed';
import { appDb } from '../../platform/db/db';
import { config } from '../../platform/config';
import { startFakeOpenAI, type FakeOpenAI } from '../../../tests/support/openai';
import { counts } from '../../../tests/fixtures/world';

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

  it('should report progress and answer the summary through the frozen ingest', async () => {
    // Arrange
    appDb().exec('DELETE FROM embedding_cache');
    const messages: string[] = [];
    // Act
    const result = await ingest((message) => messages.push(message));
    // Assert
    assert.deepEqual(Object.keys(result), ['documents', 'chunks', 'model', 'dimensions']);
    assert.deepEqual(
      [result.documents, result.model, result.dimensions],
      [counts.documents, config.embeddingModel, 1536],
    );
    assert.deepEqual(messages, [
      `${counts.documents} documents · ${result.chunks} chunks`,
      'Index updated.',
    ]);
  });
});

describe('readDocument', () => {
  it('should read a manifest document through the frozen documents and readDocument', () => {
    // Arrange
    const [doc] = documents();
    // Act
    const text = readDocument(doc);
    // Assert
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0);
  });
});
