import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { exportIndex } from './sqlite-chunk-store';
/** Writes the current index as the committed snapshot the seed restores without calling OpenAI. */
export function saveInitialIndex() {
  fs.mkdirSync('fixtures/embeddings', { recursive: true });
  fs.writeFileSync('fixtures/embeddings/index.json.gz', gzipSync(JSON.stringify(exportIndex())));
}
