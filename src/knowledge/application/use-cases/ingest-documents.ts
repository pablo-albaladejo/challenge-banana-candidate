import { chunkDocument } from '../../domain/chunker';
import { EMBEDDING_DIMENSIONS } from '../../domain/retrieval';
import type { ChunkStore } from '../ports/chunk-store';
import type { DocumentCatalog } from '../ports/document-catalog';
import type { Embedder } from '../ports/embedder';
import type { KnowledgeSettings } from '../ports/settings';
import type { Chunk } from '../../../types';

export type IngestDocumentsCommand = { onProgress?: (value: string) => void };

/**
 * Chunks the whole corpus, embeds every chunk (cached ones are reused) and replaces the index in
 * one transaction, so a failed batch keeps the previous index.
 */
export const makeIngestDocuments =
  ({
    catalog,
    embedder,
    chunks,
    settings,
  }: {
    catalog: DocumentCatalog;
    embedder: Embedder;
    chunks: ChunkStore;
    settings: KnowledgeSettings;
  }) =>
  async ({ onProgress = () => {} }: IngestDocumentsCommand = {}) => {
    const docs = catalog.list();
    const all: Chunk[] = docs.flatMap((doc) => chunkDocument(doc, catalog.read(doc)));
    onProgress(`${docs.length} documents · ${all.length} chunks`);
    const vectors = await embedder.embed(all.map((c) => c.text));
    const complete = all.map((c, i) => ({ ...c, vector: vectors[i] }));
    chunks.replace(complete, { model: settings.embeddingModel, dimensions: EMBEDDING_DIMENSIONS });
    onProgress('Index updated.');
    return {
      documents: docs.length,
      chunks: complete.length,
      model: settings.embeddingModel,
      dimensions: EMBEDDING_DIMENSIONS,
    };
  };
