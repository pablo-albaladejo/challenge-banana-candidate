import type { SearchResult } from '../../../types';
/** Keyword retrieval over the same chunks, best match first, unfiltered by audience or validity. */
export type LexicalIndex = { search(query: string): SearchResult[] };
