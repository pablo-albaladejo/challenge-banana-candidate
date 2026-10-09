import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { documents, readDocument } from './pipeline';
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
});
