import { config, referenceDate } from '../config';
import { embedTexts } from './embeddings';
import { allChunks, indexModel } from './store';
import type { SearchResult } from '../types';
export async function searchDocuments(
  query: string,
  role = 'customer',
  limit = 5,
): Promise<SearchResult[]> {
  const model = indexModel();
  if (model === undefined)
    throw new Error('No document index. Run npm run setup or npm run ingest.');
  if (model !== config.embeddingModel)
    throw new Error('The model does not match the index. Re-ingest the documents.');
  const [queryVector] = await embedTexts([query]);
  return (
    allChunks()
      .filter((c) => role === 'operator' || c.audience === 'public')
      // Only versions in force on the reference date: superseded versions all carry a past validTo.
      .filter(
        (c) =>
          (!c.validFrom || c.validFrom <= referenceDate) &&
          (!c.validTo || c.validTo >= referenceDate),
      )
      .map(({ vector, ...c }) => {
        if (vector!.length !== queryVector.length)
          throw new Error('Incompatible embedding dimensions.');
        const score = vector!.reduce((sum, v, i) => sum + v * queryVector[i], 0);
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  );
}
