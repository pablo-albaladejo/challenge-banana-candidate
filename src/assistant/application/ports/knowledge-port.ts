import type { SearchResult } from '../../../types';
/** The documentation retrieved for a customer message. */
export type KnowledgePort = { search(query: string): Promise<SearchResult[]> };
