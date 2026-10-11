// Lexical retrieval for when there are no embeddings (the claude-cli provider, or OpenAI out of
// quota): SQLite FTS5 ranked by BM25 over the same `chunks` rows. The FTS table is created and
// filled lazily, and rebuilt whenever it no longer mirrors `chunks` (after an ingest or a seed),
// so it needs no migration and ingestion does not know it exists.
import { appDb } from '../../platform/db/db';
import { lexicalQuery } from '../domain/lexical-query';
import type { LexicalIndex } from '../application/ports/lexical-index';
import type { SearchResult } from '../../types';

type Db = ReturnType<typeof appDb>;
type Row = {
  id: string;
  document_id: string;
  text: string;
  title: string | null;
  version: number | null;
  valid_from: string | null;
  valid_to: string | null;
  audience: string;
  score: number;
};

/** Creates `chunks_fts` if missing and refills it when it is empty or stale. */
function ensureLexicalIndex(db: Db) {
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title, text, tokenize='porter unicode61 remove_diacritics 2')",
  );
  // Same rowids, titles and texts as `chunks`, or rebuild: replaceChunks reuses rowids, so the
  // texts are compared too. A few hundred rowid lookups per search.
  const { stale } = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM chunks) != (SELECT COUNT(*) FROM chunks_fts)
          OR EXISTS (SELECT 1 FROM chunks c LEFT JOIN chunks_fts f ON f.rowid = c.rowid
                     WHERE f.rowid IS NULL OR f.text IS NOT c.text OR f.title IS NOT c.title) AS stale`,
    )
    .get() as { stale: number };
  if (stale)
    db.transaction(() => {
      db.exec('DELETE FROM chunks_fts');
      db.exec('INSERT INTO chunks_fts(rowid,title,text) SELECT rowid,title,text FROM chunks');
    })();
}

/**
 * Every chunk matching any word of the query, best BM25 match first, with `score` = -bm25 (higher
 * is better) and no vector. Visibility and validity filters are the caller's (the SearchDocuments use case).
 */
export function lexicalSearch(query: string): SearchResult[] {
  const match = lexicalQuery(query);
  if (!match) return [];
  const db = appDb();
  ensureLexicalIndex(db);
  const rows = db
    .prepare(
      `SELECT c.id,c.document_id,c.text,c.title,c.version,c.valid_from,c.valid_to,c.audience,
              -bm25(chunks_fts) AS score FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
       WHERE chunks_fts MATCH ? ORDER BY score DESC, c.id`,
    )
    .all(match) as Row[];
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    text: r.text,
    title: r.title,
    version: r.version,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    audience: r.audience,
    score: r.score,
  }));
}
/** The `LexicalIndex` port over the lazily built `chunks_fts`. */
export const sqliteLexicalIndex: LexicalIndex = { search: lexicalSearch };
