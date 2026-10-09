import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument } from './chunker';
import { documentRecordFactory } from '../../tests/fixtures/factories';
describe('chunkDocument', () => {
  it('should split text into consecutive 650-character windows', () => {
    // Arrange
    const doc = documentRecordFactory.build();
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
    const doc = documentRecordFactory.build();
    const text = '  hello world  ';
    // Act
    const chunks = chunkDocument(doc, text);
    // Assert
    assert.equal(chunks[0].text, 'hello world');
  });
  it('should skip windows that contain only whitespace', () => {
    // Arrange
    const doc = documentRecordFactory.build();
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
    const doc = documentRecordFactory.build();
    const text = '   \n  ';
    // Act
    const chunks = chunkDocument(doc, text);
    // Assert
    assert.deepEqual(chunks, []);
  });
  it('should derive the same 24-hex ids for the same document and text', () => {
    // Arrange
    const doc = documentRecordFactory.build();
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
    const doc = documentRecordFactory.build();
    const other = { ...doc, id: documentRecordFactory.build().id };
    // Act
    const [a] = chunkDocument(doc, 'same text');
    const [b] = chunkDocument(other, 'same text');
    // Assert
    assert.notEqual(a.id, b.id);
  });
  it('should copy the document id and audience onto every chunk', () => {
    // Arrange
    const doc = documentRecordFactory.build({ audience: 'internal' });
    const text = 'z'.repeat(2000);
    // Act
    const chunks = chunkDocument(doc, text);
    // Assert
    assert.ok(chunks.every((c) => c.documentId === doc.id && c.audience === doc.audience));
  });
  it('should carry the title, version and validity on every chunk', () => {
    // Arrange
    const expired = documentRecordFactory.build({ validTo: '2026-08-31' });
    // Act
    const chunks = chunkDocument(expired, 'x'.repeat(2000));
    // Assert
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.equal(chunk.title, expired.title);
      assert.equal(chunk.version, expired.version);
      assert.equal(chunk.validFrom, expired.validFrom);
      assert.equal(chunk.validTo, expired.validTo);
    }
  });
});
