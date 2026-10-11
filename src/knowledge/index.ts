// Public surface of the knowledge feature: other features import only from here.
export { knowledge, type KnowledgeApp } from './entry-points/dependencies';
export { searchDocumentsTool } from './entry-points/tools/search-documents.tool';
export { documentChunks, documentDetail, listDocuments } from './entry-points/http/documents';
export { search } from './entry-points/http/search';
export { runIngestion } from './entry-points/http/ingestion';
export {
  documents,
  readDocument,
  ingest,
  saveInitialIndex,
  restoreIndex,
} from './entry-points/legacy';
