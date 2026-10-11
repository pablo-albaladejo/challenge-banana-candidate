// The retrieval rules: who sees which document or chunk, which versions are in force, how a query
// vector ranks the index, and when the stored index cannot answer. Pure: the index, the documents
// and the reference date come from the caller.
import { NotFoundError } from '../../shared/domain/errors';
import type { Chunk, DocumentRecord, SearchResult } from '../../types';

/** Size of every index vector (`text-embedding-3-small` at 1536). */
export const EMBEDDING_DIMENSIONS = 1536;

/** `semantic`: OpenAI embeddings; `lexical`: FTS5/BM25, when embeddings are unavailable. */
export type SearchMode = 'semantic' | 'lexical';

/** Operators see everything; anyone else only what is public. */
export const canSee = (role: string, audience: string) =>
  role === 'operator' || audience === 'public';

/** Only versions in force on the date: superseded versions all carry a past validTo. */
export const inForceOn = (chunk: Pick<Chunk, 'validFrom' | 'validTo'>, date: string) =>
  (!chunk.validFrom || chunk.validFrom <= date) && (!chunk.validTo || chunk.validTo >= date);

/** Who may read a chunk: operators everything, anyone else public chunks; only versions in force. */
export const visibleTo = (role: string, date: string) => (c: Omit<Chunk, 'vector'>) =>
  canSee(role, c.audience) && inForceOn(c, date);

/** The chunks by dot product with the query (vectors are normalized, so cosine), best `limit`. */
export function rankChunks(chunks: Chunk[], queryVector: number[], limit: number): SearchResult[] {
  return chunks
    .map(({ vector, ...c }) => {
      if (vector!.length !== queryVector.length)
        throw new Error('Incompatible embedding dimensions.');
      const score = vector!.reduce((sum, v, i) => sum + v * queryVector[i], 0);
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The model of the stored index; a plain Error (a 500, as before) when nothing was ingested. */
export function requireIndex(indexModel: string | undefined): string {
  if (indexModel === undefined)
    throw new Error('No document index. Run npm run setup or npm run ingest.');
  return indexModel;
}

/** A query embedded with another model than the index would rank noise: refuse it. */
export function assertIndexMatches(indexModel: string, embeddingModel: string) {
  if (indexModel !== embeddingModel)
    throw new Error('The model does not match the index. Re-ingest the documents.');
}

/** The manifest as the role may see it. */
export const visibleDocuments = (role: string, docs: DocumentRecord[]) =>
  docs.filter((d) => canSee(role, d.audience));

/** One visible document; an unknown or invisible one is the same 404. */
export function findVisibleDocument(role: string, docs: DocumentRecord[], id: string) {
  const doc = visibleDocuments(role, docs).find((d) => d.id === id);
  if (!doc) throw new NotFoundError('Document not found.');
  return doc;
}
