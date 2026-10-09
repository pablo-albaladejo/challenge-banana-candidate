<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# retrieval

## Purpose

Embeddings, the SQLite-backed vector store, and semantic search over document chunks. Also owns the OpenAI client factory used by the agent.

## Key Files

| File            | Description                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `embeddings.ts` | `dimensions = 1536`; `openai()` (throws `MissingOpenAIKeyError` if `OPENAI_API_KEY` blank; `maxRetries:2`, 45 s timeout); `embedTexts(texts)` with `embedding_cache` lookup and batches of 48; `vectorBuffer`/`readVector` (Float32 BLOB); `embeddingKey` = sha256(model:dims:`text-v1`:text) |
| `store.ts`      | `replaceChunks` (transactional full replace; sets `meta.index-model`, `meta.index-dimensions`), `allChunks()`, `exportIndex()`/`restoreIndex()` (gz JSON dump, `format:1`, model must equal `OPENAI_EMBEDDING_MODEL`; also refills `embedding_cache`)                                         |
| `search.ts`     | `searchDocuments(query, role='customer', limit=5)`: requires `meta.index-model` matching config, embeds the query, loads **all** chunks, filters `audience==='public'` unless `role==='operator'`, scores by dot product, returns top `limit` as `SearchResult`                               |

## For AI Agents

### Working In This Directory

- Index lives in app DB tables `chunks`, `embedding_cache`, `meta` (not the bank DB). Callers: `agent/run.ts`, `agent/tools.ts`, `ingestion/pipeline.ts`, `seed.ts`, the `/api/search` route.
- Vectors are assumed normalized, so dot product = cosine; there is no ANN index (full scan on every query).
- Things worth scrutinizing:
  - `searchDocuments` ranks purely by similarity: no filter on `validFrom`/`validTo`/`version` against `referenceDate`, no minimum score, so outdated or superseded passages can rank first and weak matches are still returned.
  - Only offset-0 chunks have validity metadata (see `ingestion/chunker.ts`).
  - `role` is a plain parameter; agent callers use the default `customer`, which keeps `internal` docs out, but any new caller passing `operator` exposes them.
  - `embedTexts` caches by text but a failed batch mid-way aborts the whole call; the OpenAI error path is not translated beyond `MissingOpenAIKeyError`.
  - `restoreIndex` throws when the model differs; `seed.ts` does not catch it.

### Testing Requirements

- `npm test`: seeded index (>300 chunks, all 1536-dim, reproducible across `seedApp()`), and `/api/search` returns 503 `missing_openai_api_key` with a "restart" hint when the key is blank. Real embedding calls are not tested.

### Common Patterns

- Float32 BLOB round-trip via `vectorBuffer`/`readVector`; `INSERT OR REPLACE` for cache and meta.
- Throw plain `Error` for index/model mismatch; the route maps messages to responses.

## Dependencies

### Internal

- `../db`, `../config`, `../types`; consumed by `../agent`, `../ingestion`, `../seed`.

### External

- `openai` (embeddings), `node:crypto`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
