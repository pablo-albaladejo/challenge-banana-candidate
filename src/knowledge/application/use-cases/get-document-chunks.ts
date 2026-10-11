import { findVisibleDocument } from '../../domain/retrieval';
import type { ChunkStore } from '../ports/chunk-store';
import type { DocumentCatalog } from '../ports/document-catalog';

/** The indexed chunks of a visible document, without their vectors. */
export const makeGetDocumentChunks =
  ({ catalog, chunks }: { catalog: DocumentCatalog; chunks: ChunkStore }) =>
  ({ role, id }: { role: string; id: string }) => {
    const doc = findVisibleDocument(role, catalog.list(), id);
    return chunks
      .all()
      .filter((c) => c.documentId === doc.id)
      .map(({ vector, ...c }) => c);
  };
