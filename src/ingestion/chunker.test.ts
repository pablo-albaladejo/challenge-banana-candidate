import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument } from './chunker';
import type { DocumentRecord } from '../types';
const doc: DocumentRecord = {
  id: 'doc-test',
  title: 'Test document',
  file: 'doc-test.md',
  version: 2,
  validFrom: '2026-09-01',
  validTo: null,
  audience: 'internal',
  family: 'procedure',
};
describe('chunkDocument', () => {
  it('should split text into consecutive 650-character windows', () => {
    // Arrange
    const text = 'a'.repeat(650) + 'b'.repeat(650) + 'c'.repeat(200);
    // Act
    const chunks = chunkDocument(doc, text);
    // Assert
    assert.deepEqual(
      chunks.map((c) => c.text),
      ['a'.repeat(650), 'b'.repeat(650), 'c'.repeat(200)],
    );
  });
  it('should trim surrounding whitespace from each chunk', () => {
    // Arrange
    const text = '  hello world  ';
    // Act
    const chunks = chunkDocument(doc, text);
    // Assert
    assert.equal(chunks[0].text, 'hello world');
  });
  it('should skip windows that contain only whitespace', () => {
    // Arrange
    const text = 'a'.repeat(650) + ' '.repeat(650) + 'c'.repeat(10);
    // Act
    const chunks = chunkDocument(doc, text);
    // Assert
    assert.deepEqual(
      chunks.map((c) => c.text),
      ['a'.repeat(650), 'c'.repeat(10)],
    );
  });
  it('should produce no chunks for blank text', () => {
    // Arrange
    const text = '   \n  ';
    // Act
    const chunks = chunkDocument(doc, text);
    // Assert
    assert.deepEqual(chunks, []);
  });
  it('should derive the same 24-hex ids for the same document and text', () => {
    // Arrange
    const text = 'x'.repeat(1300);
    // Act
    const first = chunkDocument(doc, text).map((c) => c.id);
    const second = chunkDocument(doc, text).map((c) => c.id);
    // Assert
    assert.deepEqual(second, first);
    assert.ok(first.every((id) => /^[0-9a-f]{24}$/.test(id)));
    assert.equal(new Set(first).size, first.length);
  });
  it('should derive different ids for different documents with the same text', () => {
    // Arrange
    const other = { ...doc, id: 'doc-other' };
    // Act
    const [a] = chunkDocument(doc, 'same text');
    const [b] = chunkDocument(other, 'same text');
    // Assert
    assert.notEqual(a.id, b.id);
  });
  it('should copy the document id and audience onto every chunk', () => {
    // Arrange
    const text = 'z'.repeat(2000);
    // Act
    const chunks = chunkDocument(doc, text);
    // Assert
    assert.ok(chunks.every((c) => c.documentId === 'doc-test' && c.audience === 'internal'));
  });
  it('should carry the title, version and validity on the first chunk', () => {
    // Arrange
    const expired = { ...doc, version: 1, validFrom: '2026-01-01', validTo: '2026-08-31' };
    // Act
    const [first] = chunkDocument(expired, 'short body');
    // Assert
    assert.equal(first.title, 'Test document');
    assert.equal(first.version, 1);
    assert.equal(first.validFrom, '2026-01-01');
    assert.equal(first.validTo, '2026-08-31');
  });
});
