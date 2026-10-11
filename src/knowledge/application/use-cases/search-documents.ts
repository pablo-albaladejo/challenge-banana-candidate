import { referenceDate } from '../../../shared/domain/reference-date';
import {
  assertIndexMatches,
  rankChunks,
  requireIndex,
  visibleTo,
  type SearchMode,
} from '../../domain/retrieval';
import type { ChunkStore } from '../ports/chunk-store';
import type { Embedder } from '../ports/embedder';
import type { LexicalIndex } from '../ports/lexical-index';
import type { KnowledgeSettings } from '../ports/settings';
import type { SearchResult } from '../../../types';

/** `role` decides the audience (the agent tool and the assistant search as a customer). */
export type SearchDocumentsCommand = { query: string; role: string; limit?: number };
export type SearchOutcome = { mode: SearchMode; sources: SearchResult[] };

/**
 * The visible passages in force on the reference date, best first, with the mode that answered:
 * lexical under claude-cli, or when an `auto` embedding call ran out of OpenAI quota and the
 * gateway allows the claude-cli fallback; semantic otherwise.
 */
export const makeSearchDocuments =
  ({
    chunks,
    lexical,
    embedder,
    settings,
  }: {
    chunks: ChunkStore;
    lexical: LexicalIndex;
    embedder: Embedder;
    settings: KnowledgeSettings;
  }) =>
  async ({ query, role, limit = 5 }: SearchDocumentsCommand): Promise<SearchOutcome> => {
    const model = requireIndex(chunks.indexModel());
    const visible = visibleTo(role, referenceDate);
    const lexically = () => ({
      mode: 'lexical' as const,
      sources: lexical.search(query).filter(visible).slice(0, limit),
    });
    if (!(await embedder.available())) return lexically();
    assertIndexMatches(model, settings.embeddingModel);
    let queryVector: number[];
    try {
      [queryVector] = await embedder.embed([query]);
    } catch (e) {
      if (!(await embedder.fallsBackOn(e))) throw e;
      return lexically();
    }
    return {
      mode: 'semantic',
      sources: rankChunks(chunks.all().filter(visible), queryVector, limit),
    };
  };
