/**
 * The words of a query as an FTS5 expression: each one quoted (so no character of the query is
 * read as FTS syntax) and OR-ed, leaving the ranking to BM25. `undefined` when there is no word.
 */
export function lexicalQuery(query: string): string | undefined {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  return words.length ? words.map((w) => `"${w}"`).join(' OR ') : undefined;
}
