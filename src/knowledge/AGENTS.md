<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# knowledge

## Purpose

The bank's document corpus as searchable knowledge: ingestion (read the corpus in `fixtures/documents/`, chunk, embed), the SQLite-backed vector store, semantic search, the `search_documents` agent tool and the `documents`, `search` and `ingestion` endpoints.

## Key Files

| File                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                       | Public surface: `searchDocumentsTool`, `searchDocuments`, `restoreIndex`, `documents`                                                                                                                                                                                                                                                                                                                                                                           |
| `search/embeddings.ts`           | `dimensions = 1536`; re-exports `openai()` and `MissingOpenAIKeyError` from `../platform/model/gateway.ts` (frozen surface); `embedTexts(texts)` (calls `createEmbeddings`) with `embedding_cache` lookup and batches of 48; `vectorBuffer`/`readVector` (Float32 BLOB); `embeddingKey` = sha256(model:dims:`text-v1`:text). Frozen at `src/retrieval/embeddings.ts` (shim)                                                                                     |
| `search/store.ts`                | `replaceChunks` (transactional full replace; sets `meta.index-model`, `meta.index-dimensions`), `allChunks()`, `indexModel()` (model of the stored index, or undefined), `chunkCount()` (`{ chunks }`), `exportIndex()`/`restoreIndex()` (gz JSON dump, `format:1`, model must equal `OPENAI_EMBEDDING_MODEL`; also refills `embedding_cache`). Frozen at `src/retrieval/store.ts` (shim)                                                                       |
| `search/search.ts`               | `searchDocuments(query, role='customer', limit=5)`: requires `indexModel()` matching config, embeds the query, loads **all** chunks, filters `audience==='public'` unless `role==='operator'`, scores by dot product, returns top `limit` as `SearchResult`                                                                                                                                                                                                     |
| `ingestion/pipeline.ts`          | `documents()` reads the manifest (`DocumentRecord[]`); `readDocument(doc)` reads a file under `fixtures/documents` (path-traversal guarded), strips `<script>` and tags for `.html`, normalizes CRLF; `ingest(onProgress)` chunks all docs, `embedTexts`, `replaceChunks`, returns `{documents, chunks, model, dimensions}`; `saveInitialIndex()` writes `fixtures/embeddings/index.json.gz` from `exportIndex()`. Frozen at `src/ingestion/pipeline.ts` (shim) |
| `ingestion/chunker.ts`           | `chunkDocument(doc, text)`: fixed 650-character windows, no overlap, trimmed; id = first 24 hex of sha256(`docId:offset:text`); only the first chunk (offset 0) carries `title`, `version`, `validFrom`, `validTo`                                                                                                                                                                                                                                              |
| `tools/search-documents.tool.ts` | `searchDocumentsTool` (`search_documents`): zod-parsed `query`, `searchDocuments` as a customer                                                                                                                                                                                                                                                                                                                                                                 |
| `http/search.ts`                 | `search` (`POST search`): `searchDocuments(query, actor.role)`                                                                                                                                                                                                                                                                                                                                                                                                  |
| `http/documents.ts`              | `listDocuments`, `documentDetail`, `documentChunks`: customers see `public` documents only                                                                                                                                                                                                                                                                                                                                                                      |
| `http/ingestion.ts`              | `runIngestion` (`POST ingestion`, operators): `ingest()`                                                                                                                                                                                                                                                                                                                                                                                                        |

## For AI Agents

### Working In This Directory

- Index lives in app DB tables `chunks`, `embedding_cache`, `meta` (not the bank DB). `search/store.ts` and `search/embeddings.ts` are the only owners of that SQL. Callers: `../assistant/conversation.ts`, `tools/search-documents.tool.ts`, `ingestion/pipeline.ts`, `../server/seed.ts` (`restoreIndex`, `documents`), the `http/` handlers.
- Triggered by `npm run ingest` / `npm run setup` (scripts in `scripts/`); the seed can instead restore the committed index without calling OpenAI. Ingest is a full replace in one transaction (`replaceChunks`); embeddings are cached in `embedding_cache` by model+dimensions+text.
- Vectors are assumed normalized, so dot product = cosine; there is no ANN index (full scan on every query).
- Things worth scrutinizing:
  - `searchDocuments` ranks purely by similarity: no filter on `validFrom`/`validTo`/`version` against `referenceDate`, no minimum score, so outdated or superseded passages can rank first and weak matches are still returned.
  - `ingestion/chunker.ts`: later chunks have `version`, `validFrom`, `validTo` and `title` as `null`, so downstream filtering by validity or version cannot apply to them.
  - Manifest `family`, `version`, `validTo` are carried but superseded versions are all indexed; nothing dedupes or expires by `referenceDate`.
  - Chunk cuts mid-word/sentence; HTML stripping is regex-based (visible hidden text and entities other than `&nbsp;`/`&amp;` remain), so document content flows into the model prompt as-is.
  - `role` is a plain parameter; agent callers use the default `customer`, which keeps `internal` docs out, but any new caller passing `operator` exposes them.
  - `embedTexts` caches by text but a failed batch mid-way aborts the whole call; the OpenAI error path is not translated beyond `MissingOpenAIKeyError`.
  - `restoreIndex` throws when the model differs; the seed does not catch it.

### Testing Requirements

- `npm test`: `search/{embeddings,store,search}.test.ts`, `ingestion/{chunker,pipeline}.test.ts` (the manifest: 80 unique docs, an internal doc exists, some with `validTo`, each readable and >1000 chars), `tools/search-documents.tool.test.ts`; the seeded index (>300 chunks, all 1536-dim, reproducible across `seedApp()`); `/api/search` returns 503 `missing_openai_api_key` with a "restart" hint when the key is blank. Real embedding calls are not tested; re-running `ingest` needs `OPENAI_API_KEY`.

### Common Patterns

- Float32 BLOB round-trip via `vectorBuffer`/`readVector`; named-column `INSERT OR REPLACE` for cache and meta.
- Pure functions for chunking/reading; side effects confined to `ingest` and `saveInitialIndex`. Paths are relative to the process cwd (`path.resolve('fixtures/...')`).
- Throw plain `Error` for index/model mismatch; the HTTP layer maps messages to responses.

## Dependencies

### Internal

- `../platform` (`db/db`, `config`, `model/gateway`, `http/`), `../assistant` (`Tool` type only), `../types`.

### External

- `node:fs`, `node:crypto`, `node:zlib`, `zod`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
