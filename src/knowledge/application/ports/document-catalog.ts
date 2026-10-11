import type { DocumentRecord } from '../../../types';
/** The corpus: its manifest and the plain text of each document. */
export type DocumentCatalog = { list(): DocumentRecord[]; read(doc: DocumentRecord): string };
