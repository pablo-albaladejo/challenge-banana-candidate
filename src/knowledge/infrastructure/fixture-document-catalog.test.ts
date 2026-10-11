import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { documents, readDocument } from './fixture-document-catalog';
import { documentRecordFactory } from '../../../tests/fixtures/factories';
import { counts } from '../../../tests/fixtures/world';
// readDocument resolves fixtures/documents from the cwd, so a temp corpus needs a temp cwd.
function readFromTempCorpus(file: string, content: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-corpus-'));
  const cwd = process.cwd();
  fs.mkdirSync(path.join(root, 'fixtures/documents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fixtures/documents', file), content);
  process.chdir(root);
  try {
    return readDocument(documentRecordFactory.build({ file }));
  } finally {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
describe('documents', () => {
  it('should list the 80 corpus originals with unique ids', () => {
    // Arrange
    // Act
    const docs = documents();
    // Assert
    assert.equal(docs.length, counts.documents);
    assert.equal(new Set(docs.map((d) => d.id)).size, counts.documents);
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
    const doc = documentRecordFactory.build({ file: '../conversations.json' });
    // Act & Assert
    assert.throws(() => readDocument(doc), /Invalid document path/);
  });
});
