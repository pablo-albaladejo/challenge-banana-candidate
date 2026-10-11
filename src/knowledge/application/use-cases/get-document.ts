import { findVisibleDocument } from '../../domain/retrieval';
import type { DocumentCatalog } from '../ports/document-catalog';

/** A visible document with its plain text; an invisible one is not found. */
export const makeGetDocument =
  ({ catalog }: { catalog: DocumentCatalog }) =>
  ({ role, id }: { role: string; id: string }) => {
    const doc = findVisibleDocument(role, catalog.list(), id);
    return { ...doc, text: catalog.read(doc) };
  };
