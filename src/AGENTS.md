<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# src

## Purpose

Application core, imported by the Next.js catch-all route (`app/api/[...path]/route.ts`), `scripts/`, and `tests/`. Top-level files hold shared plumbing (config, app DB, identity, session auth, seed, telemetry, types); feature code lives in subdirectories. Everything here uses the **app DB** (`<DATA_DIR>/app.sqlite`); bank state lives behind HTTP in the simulator (`simulator/`), reached only via `banking/client.ts`.

## Key Files

| File           | Description                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`    | Loads `.env.local` then `.env` (dotenv); exports `config` (`DATA_DIR`, `BANK_DATA_DIR`, `BANK_URL`, `BANK_PORT`, `APP_PORT`, `BANK_SERVICE_SECRET`, `BANK_ADMIN_SECRET`, `SESSION_SECRET`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`, `BANK_TIMEOUT_MS` default 1400) and `referenceDate = '2026-09-24'`. Secrets have hard-coded local defaults |
| `db.ts`        | `appDb()` lazy singleton (better-sqlite3, WAL, FK on, busy_timeout 5000) creating tables `meta, conversations, messages, runs, intents, approvals, incidents, events, chunks, embedding_cache`; `closeAppDb()`                                                                                                                                       |
| `auth.ts`      | `sign` (HMAC-SHA256 hex), `equal` (timing-safe), `sessionToken(userId)` -> `id.sig`, `actor(request)` parses the `banana_actor` cookie into a `Person` or throws `HttpError(401)`, `sameOrigin(request)` (Origin vs Host), `HttpError`                                                                                                               |
| `people.ts`    | Static roster: 8 customers (lucia, bruno, carla, diego, elena, hugo, ines, omar) and 2 operators (marta, pablo); `person(id)`                                                                                                                                                                                                                        |
| `seed.ts`      | `seedApp()`: in one transaction wipes app tables, loads `fixtures/conversations.json` (conversations, messages, incidents from `case`), inserts one historic failed intent for lucia, sets `meta.seed`, then `restoreIndex` from `fixtures/embeddings/index.json.gz` if present                                                                      |
| `telemetry.ts` | `recordEvent(ctx, kind, data)` inserts into `events`                                                                                                                                                                                                                                                                                                 |
| `types.ts`     | `Person, Account, TransferInput, Operation, ToolContext, ActionResult, DocumentRecord, Chunk, SearchResult`                                                                                                                                                                                                                                          |

## Subdirectories

| Directory    | Purpose                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| `agent/`     | OpenAI Responses loop, prompt, tool definitions (see `agent/AGENTS.md`)        |
| `banking/`   | Signed client for the bank API and transfer workflow (see `banking/AGENTS.md`) |
| `ingestion/` | Document chunking and index build (see `ingestion/AGENTS.md`)                  |
| `operator/`  | Operator case view (see `operator/AGENTS.md`)                                  |
| `retrieval/` | Embeddings, vector store, search (see `retrieval/AGENTS.md`)                   |

## For AI Agents

### Working In This Directory

- Identity comes only from the signed cookie via `actor()`; never trust a user id from the body or headers.
- Schema changes go in `db.ts` (`CREATE TABLE IF NOT EXISTS`, no migrations) and must be mirrored in `seed.ts` wipe list and its positional `INSERT`s (column order matters).
- `db.ts` and `config.ts` read env/paths at first use; tests set `DATA_DIR` before dynamic imports.
- Things worth scrutinizing:
  - `telemetry.ts:recordEvent` persists only `{tool, status}`; arguments, outputs, errors and durations passed by callers are dropped.
  - `auth.ts`: token has no expiry; `sameOrigin` passes when no `Origin` header is sent; default secrets in `config.ts` apply if env is unset.
  - `db.ts` defines an `approvals` table that nothing writes or reads.
  - `seed.ts` deletes everything (including `meta`) - safe only for local reset.

### Testing Requirements

- `npm test` (colocated `*.test.ts`, see `TESTING.md`) covers: `seedApp` reproducibility (47 conversations, 17 incidents, 8 closed, index >300 chunks of 1536 dims), signed-session/`sameOrigin` behaviour, and the missing-API-key search response. `npm run typecheck` for types.

### Common Patterns

- Errors surface as `HttpError(status, message)`; the API route maps them to JSON.
- Raw prepared statements with positional `INSERT INTO t VALUES(...)`; timestamps are ISO strings from `new Date().toISOString()`.

## Dependencies

### Internal

- `fixtures/` (seed data, index), `simulator/` (via HTTP only), `app/api/[...path]/route.ts` (caller).

### External

- `better-sqlite3`, `dotenv`, `node:crypto`, `node:zlib`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
