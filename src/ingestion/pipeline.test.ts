import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { documents, ingest, readDocument } from './pipeline';
import { chunkDocument } from './chunker';
import { allChunks } from '../retrieval/store';
import { seedApp } from '../seed';
import { appDb } from '../db';
import { config } from '../config';
import { startFakeOpenAI, type FakeOpenAI } from '../../tests/support/openai';
import type { DocumentRecord } from '../types';
const fixture = (file: string): DocumentRecord => ({
  id: 'fixture',
  title: 'Fixture',
  file,
  version: 2,
  validFrom: '2026-09-01',
  validTo: null,
  audience: 'public',
  family: 'faq',
});
// readDocument resolves fixtures/documents from the cwd, so a temp corpus needs a temp cwd.
function readFromTempCorpus(file: string, content: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-corpus-'));
  const cwd = process.cwd();
  fs.mkdirSync(path.join(root, 'fixtures/documents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fixtures/documents', file), content);
  process.chdir(root);
  try {
    return readDocument(fixture(file));
  } finally {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const embeddingCalls = (fake: FakeOpenAI) =>
  fake.requests.filter((r) => r.path.endsWith('/embeddings'));
describe('documents', () => {
  it('should list the 80 corpus originals with unique ids', () => {
    // Arrange
    // Act
    const docs = documents();
    // Assert
    assert.equal(docs.length, 80);
    assert.equal(new Set(docs.map((d) => d.id)).size, 80);
  });
  it('should include internal and expired documents in the manifest', () => {
    // Arrange
    // Act
    const docs = documents();
    // Assert
    assert.ok(docs.some((d) => d.audience === 'internal'));
    assert.ok(docs.some((d) => d.validTo));
  });
});
describe('readDocument', () => {
  it('should read substantive content for every original', () => {
    // Arrange
    const docs = documents();
    // Act
    const lengths = docs.map((d) => readDocument(d).length);
    // Assert
    assert.ok(lengths.every((length) => length > 1000));
  });
  it('should strip markup from HTML documents', () => {
    // Arrange
    const doc = documents().find((d) => d.file.endsWith('.html'))!;
    // Act
    const text = readDocument(doc);
    // Assert
    assert.doesNotMatch(text, /<[^>]+>/);
    assert.match(text, /current operations/);
  });
  it('should drop scripts and decode nbsp and amp entities in HTML', () => {
    // Arrange
    const html = '<section><p>Fees&nbsp;&amp;&nbsp;limits</p><script>alert("x")</script></section>';
    // Act
    const text = readFromTempCorpus('page.html', html);
    // Assert
    assert.equal(text.trim(), 'Fees & limits');
  });
  it('should normalize CRLF line endings to LF', () => {
    // Arrange
    const markdown = '# Title\r\nLine one\r\nLine two';
    // Act
    const text = readFromTempCorpus('note.md', markdown);
    // Assert
    assert.equal(text, '# Title\nLine one\nLine two');
  });
  it('should reject paths that escape the documents folder', () => {
    // Arrange
    const doc = fixture('../conversations.json');
    // Act & Assert
    assert.throws(() => readDocument(doc), /Invalid document path/);
  });
});
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
    const result = await ingest();
    // Assert
    assert.deepEqual(result, {
      documents: 80,
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
    await ingest();
    // Assert
    const calls = embeddingCalls(fake);
    const inputs = calls.flatMap((r) => r.body.input as string[]);
    assert.deepEqual(new Set(inputs), new Set(allChunks().map((c) => c.text)));
    assert.ok(calls.every((r) => r.body.input.length <= 48));
  });
  it('should reuse cached embeddings when ingesting again', async () => {
    // Arrange
    appDb().exec('DELETE FROM embedding_cache');
    await ingest();
    fake.reset();
    // Act
    await ingest();
    // Assert
    assert.equal(embeddingCalls(fake).length, 0);
  });
  it('should report progress with the corpus size and completion', async () => {
    // Arrange
    const messages: string[] = [];
    // Act
    const result = await ingest((message) => messages.push(message));
    // Assert
    assert.deepEqual(messages, [`80 documents · ${result.chunks} chunks`, 'Index updated.']);
  });
});
