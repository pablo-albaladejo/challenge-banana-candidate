<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# ingestion

## Purpose

Builds the document search index: reads the corpus described by `fixtures/documents/manifest.json`, splits it into chunks, embeds them, and replaces the `chunks` table in the app DB.

## Key Files

| File          | Description                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline.ts` | `documents()` reads the manifest (`DocumentRecord[]`); `readDocument(doc)` reads a file under `fixtures/documents` (path-traversal guarded), strips `<script>` and tags for `.html`, normalizes CRLF; `ingest(onProgress)` chunks all docs, `embedTexts`, `replaceChunks`, returns `{documents, chunks, model, dimensions}`; `saveInitialIndex()` writes `fixtures/embeddings/index.json.gz` from `exportIndex()` |
| `chunker.ts`  | `chunkDocument(doc, text)`: fixed 650-character windows, no overlap, trimmed; id = first 24 hex of sha256(`docId:offset:text`); only the first chunk (offset 0) carries `title`, `version`, `validFrom`, `validTo`                                                                                                                                                                                                |

## For AI Agents

### Working In This Directory

- Triggered by `npm run ingest` / `npm run setup` (scripts in `scripts/`); `seed.ts` can instead restore the committed index without calling OpenAI.
- Ingest is a full replace in one transaction (`retrieval/store.ts:replaceChunks`); embeddings are cached in `embedding_cache` by model+dimensions+text.
- Things worth scrutinizing:
  - `chunker.ts`: later chunks have `version`, `validFrom`, `validTo` and `title` as `null`, so downstream filtering by validity or version cannot apply to them.
  - Manifest `family`, `version`, `validTo` are carried but superseded versions are all indexed; nothing dedupes or expires by `referenceDate`.
  - Chunk cuts mid-word/sentence; HTML stripping is regex-based (visible hidden text and entities other than `&nbsp;`/`&amp;` remain), so document content flows into the model prompt as-is.
  - `audience` (`public|internal`) is copied per chunk; enforcement happens only in `retrieval/search.ts`.

### Testing Requirements

- `npm test` checks the manifest (80 unique docs, an internal doc exists, some with `validTo`, each readable and >1000 chars) and, via seed, >300 chunks of 1536 dims. Re-running `ingest` needs `OPENAI_API_KEY`.

### Common Patterns

- Pure functions for chunking/reading; side effects confined to `ingest` and `saveInitialIndex`. Paths are relative to the process cwd (`path.resolve('fixtures/...')`).

## Dependencies

### Internal

- `../retrieval/embeddings` (`embedTexts`, `dimensions`), `../retrieval/store` (`replaceChunks`, `exportIndex`), `../config`, `../types`.

### External

- `node:fs`, `node:crypto`, `node:zlib`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
