// The frozen `src/ingestion/pipeline` surface: `scripts/ingest.ts` and external callers keep the
// positional `ingest(onProgress)`, the manifest readers and the snapshot writer; `restoreIndex`
// is the seed's (it restores the committed snapshot).
import { knowledge } from './dependencies';
export { documents, readDocument } from '../infrastructure/fixture-document-catalog';
export { saveInitialIndex } from '../infrastructure/index-snapshot';
export { restoreIndex } from '../infrastructure/sqlite-chunk-store';
export const ingest = (onProgress: (value: string) => void = () => {}) =>
  knowledge().ingestDocuments({ onProgress });
