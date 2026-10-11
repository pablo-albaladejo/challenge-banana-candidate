import { config, referenceDate } from '../../platform/config';
import { activeProvider, fallbackProvider } from '../../platform/model/gateway';
import { embedTexts } from './embeddings';
import { lexicalSearch } from './lexical';
import { allChunks, indexModel } from './store';
import type { Chunk, SearchResult } from '../../types';

/** `semantic`: OpenAI embeddings; `lexical`: FTS5/BM25, when embeddings are unavailable. */
export type SearchMode = 'semantic' | 'lexical';

/** Who may read a chunk: operators everything, anyone else public chunks; only versions in force. */
const visibleTo = (role: string) => (c: Omit<Chunk, 'vector'>) =>
  (role === 'operator' || c.audience === 'public') &&
  // Only versions in force on the reference date: superseded versions all carry a past validTo.
  (!c.validFrom || c.validFrom <= referenceDate) &&
  (!c.validTo || c.validTo >= referenceDate);

export async function searchDocuments(
  query: string,
  role = 'customer',
  limit = 5,
): Promise<SearchResult[]> {
  return (await searchWithMode(query, role, limit)).sources;
}

/**
 * `searchDocuments` plus the mode that answered: lexical under claude-cli, or when an `auto`
 * embedding call ran out of OpenAI quota and the gateway allows the claude-cli fallback.
 */
export async function searchWithMode(
  query: string,
  role = 'customer',
  limit = 5,
): Promise<{ mode: SearchMode; sources: SearchResult[] }> {
  const model = indexModel();
  if (model === undefined)
    throw new Error('No document index. Run npm run setup or npm run ingest.');
  const lexical = () => ({
    mode: 'lexical' as const,
    sources: lexicalSearch(query).filter(visibleTo(role)).slice(0, limit),
  });
  if ((await activeProvider()) === 'claude-cli') return lexical();
  if (model !== config.embeddingModel)
    throw new Error('The model does not match the index. Re-ingest the documents.');
  let queryVector: number[];
  try {
    [queryVector] = await embedTexts([query]);
  } catch (e) {
    if (!(await fallbackProvider(e, 'embeddings'))) throw e;
    return lexical();
  }
  const sources = allChunks()
    .filter(visibleTo(role))
    .map(({ vector, ...c }) => {
      if (vector!.length !== queryVector.length)
        throw new Error('Incompatible embedding dimensions.');
      const score = vector!.reduce((sum, v, i) => sum + v * queryVector[i], 0);
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { mode: 'semantic', sources };
}
