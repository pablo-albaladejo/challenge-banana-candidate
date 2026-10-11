import { visibleDocuments } from '../../domain/retrieval';
import type { ChunkStore } from '../ports/chunk-store';
import type { DocumentCatalog } from '../ports/document-catalog';

/** The documents the role may see, and how many chunks the index holds. */
export const makeListDocuments =
  ({ catalog, chunks }: { catalog: DocumentCatalog; chunks: ChunkStore }) =>
  ({ role }: { role: string }) => ({
    documents: visibleDocuments(role, catalog.list()),
    index: chunks.count(),
  });
