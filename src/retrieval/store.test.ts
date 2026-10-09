import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allChunks, exportIndex, replaceChunks, restoreIndex } from './store';
import { embeddingKey } from './embeddings';
import { seedApp } from '../seed';
import { appDb } from '../db';
import { config } from '../config';
import { chunkFactory } from '../../tests/fixtures/factories';
const meta = (key: string) =>
  (appDb().prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)
    ?.value;
describe('replaceChunks', () => {
  beforeEach(() => seedApp());
  it('should replace the whole index and record its model and dimensions', () => {
    // Arrange
    const chunks = chunkFactory.buildList(2, {}, { dimensions: 3 });
    // Act
    replaceChunks(chunks, { model: 'test-model', dimensions: 3 });
    // Assert
    assert.deepEqual(
      allChunks().map((c) => c.id),
      chunks.map((c) => c.id).sort(),
    );
    assert.equal(meta('index-model'), 'test-model');
    assert.equal(meta('index-dimensions'), '3');
  });
  it('should reject chunks with the wrong dimensions and keep the previous index', () => {
    // Arrange
    const before = allChunks();
    const chunks = [
      chunkFactory.build({}, { dimensions: 3 }),
      chunkFactory.build({}, { dimensions: 2 }),
    ];
    // Act & Assert
    assert.throws(() => replaceChunks(chunks, { model: 'test-model', dimensions: 3 }), {
      message: 'Incomplete index.',
    });
    assert.deepEqual(allChunks(), before);
    assert.equal(meta('index-model'), config.embeddingModel);
  });
});
describe('allChunks', () => {
  beforeEach(() => seedApp());
  it('should list chunks ordered by id with their decoded vectors', () => {
    // Arrange
    // Act
    const chunks = allChunks();
    // Assert
    const ids = chunks.map((c) => c.id);
    assert.deepEqual(ids, [...ids].sort());
    assert.ok(chunks.every((c) => c.vector?.length === 1536));
  });
});
describe('exportIndex', () => {
  beforeEach(() => seedApp());
  it('should describe the index format, model and dimensions', () => {
    // Arrange
    // Act
    const dump = exportIndex();
    // Assert
    assert.equal(dump.format, 1);
    assert.equal(dump.model, config.embeddingModel);
    assert.equal(dump.dimensions, 1536);
    assert.equal(dump.chunks.length, allChunks().length);
  });
  it('should encode vectors as base64 instead of number arrays', () => {
    // Arrange
    // Act
    const [first] = exportIndex().chunks;
    // Assert
    assert.equal('vector' in first, false);
    assert.equal(Buffer.from(first.vectorBase64, 'base64').byteLength, 1536 * 4);
  });
});
describe('restoreIndex', () => {
  beforeEach(() => seedApp());
  it('should restore exactly the exported index', () => {
    // Arrange
    const before = allChunks();
    const dump = exportIndex();
    replaceChunks([chunkFactory.build({}, { dimensions: 1 })], { model: 'other', dimensions: 1 });
    // Act
    restoreIndex(dump);
    // Assert
    assert.deepEqual(allChunks(), before);
    assert.equal(meta('index-model'), config.embeddingModel);
    assert.equal(meta('index-dimensions'), '1536');
  });
  it('should refill the embedding cache for every restored chunk', () => {
    // Arrange
    const dump = exportIndex();
    appDb().exec('DELETE FROM embedding_cache');
    // Act
    restoreIndex(dump);
    // Assert
    const cached = appDb().prepare('SELECT 1 FROM embedding_cache WHERE key=?');
    assert.ok(dump.chunks.every((c) => cached.get(embeddingKey(c.text))));
  });
  it('should reject an index built with a different model and keep the current one', () => {
    // Arrange
    const before = allChunks();
    const dump = { ...exportIndex(), model: 'another-embedding-model' };
    // Act & Assert
    assert.throws(() => restoreIndex(dump), /different model/);
    assert.deepEqual(allChunks(), before);
  });
  it('should reject an unknown dump format', () => {
    // Arrange
    const dump = { ...exportIndex(), format: 2 } as unknown as ReturnType<typeof exportIndex>;
    // Act & Assert
    assert.throws(() => restoreIndex(dump), Error);
  });
});
