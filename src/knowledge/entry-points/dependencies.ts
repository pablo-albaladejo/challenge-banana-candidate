import { config } from '../../platform/config';
import { sqliteChunkStore } from '../infrastructure/sqlite-chunk-store';
import { sqliteLexicalIndex } from '../infrastructure/sqlite-lexical-index';
import { cachedOpenAIEmbedder } from '../infrastructure/cached-openai-embedder';
import { fixtureDocumentCatalog } from '../infrastructure/fixture-document-catalog';
import { makeSearchDocuments } from '../application/use-cases/search-documents';
import { makeListDocuments } from '../application/use-cases/list-documents';
import { makeGetDocument } from '../application/use-cases/get-document';
import { makeGetDocumentChunks } from '../application/use-cases/get-document-chunks';
import { makeIngestDocuments } from '../application/use-cases/ingest-documents';
import type { ChunkStore } from '../application/ports/chunk-store';
import type { LexicalIndex } from '../application/ports/lexical-index';
import type { Embedder } from '../application/ports/embedder';
import type { DocumentCatalog } from '../application/ports/document-catalog';
import type { KnowledgeSettings } from '../application/ports/settings';
export type KnowledgeDeps = {
  chunks: ChunkStore;
  lexical: LexicalIndex;
  embedder: Embedder;
  catalog: DocumentCatalog;
  settings: KnowledgeSettings;
};
const defaults = (): KnowledgeDeps => ({
  chunks: sqliteChunkStore,
  lexical: sqliteLexicalIndex,
  embedder: cachedOpenAIEmbedder,
  catalog: fixtureDocumentCatalog,
  settings: config,
});
/**
 * No overrides and no internals: no knowledge use case reads the clock or ids (retrieval dates by
 * the fixed reference date), and there is no service to reach. The index, the corpus and the model
 * gateway are always the real ones.
 */
export function wireKnowledge() {
  const deps = defaults();
  return {
    searchDocuments: makeSearchDocuments(deps),
    listDocuments: makeListDocuments(deps),
    getDocument: makeGetDocument(deps),
    getDocumentChunks: makeGetDocumentChunks(deps),
    ingestDocuments: makeIngestDocuments(deps),
  };
}
/** What index.ts exposes: the use cases. */
export type KnowledgeApp = ReturnType<typeof wireKnowledge>;
let graph: KnowledgeApp | undefined;
export const knowledge = (): KnowledgeApp => (graph ??= wireKnowledge());
