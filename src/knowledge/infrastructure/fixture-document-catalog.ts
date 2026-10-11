import fs from 'node:fs';
import path from 'node:path';
import type { DocumentCatalog } from '../application/ports/document-catalog';
import type { DocumentRecord } from '../../types';
export function documents(): DocumentRecord[] {
  return JSON.parse(fs.readFileSync(path.resolve('fixtures/documents/manifest.json'), 'utf8'));
}
export function readDocument(doc: DocumentRecord) {
  const root = path.resolve('fixtures/documents');
  const filename = path.resolve(root, doc.file);
  if (!filename.startsWith(root + path.sep)) throw new Error('Invalid document path.');
  let text = fs.readFileSync(filename, 'utf8');
  if (filename.endsWith('.html'))
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  return text.replace(/\r\n/g, '\n');
}
/** The `DocumentCatalog` port over `fixtures/documents` (manifest and files, cwd-relative). */
export const fixtureDocumentCatalog: DocumentCatalog = { list: documents, read: readDocument };
