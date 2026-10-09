<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# src

## Purpose

Application core, imported by the Next.js catch-all route (`app/api/[...path]/route.ts`, which delegates to `http/handle.ts`), `scripts/`, and `tests/`. Top-level files hold shared plumbing (config, app DB, identity, session auth, seed, telemetry, types); feature code lives in subdirectories. Everything here uses the **app DB** (`<DATA_DIR>/app.sqlite`); bank state lives behind HTTP in the simulator (`simulator/`), reached only via `banking/client.ts`.

## Key Files

| File            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`     | Loads `.env.local` then `.env` (dotenv). `loadConfig(env)` is pure and never throws; `config = loadConfig(process.env)` is mutable on purpose (tests change keys at runtime, so modules read `config.x` at call time and never destructure it) with keys `dataDir, bankDataDir, bankUrl, bankPort, appPort, serviceSecret, adminSecret, sessionSecret, chatModel, embeddingModel, bankTimeoutMs` (env: `DATA_DIR`, `BANK_DATA_DIR`, `BANK_URL`, `BANK_PORT`, `APP_PORT`, `BANK_SERVICE_SECRET`, `BANK_ADMIN_SECRET`, `SESSION_SECRET`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`, `BANK_TIMEOUT_MS` default 1400). `assertProductionSecrets(config, nodeEnv)`: pure check (secrets set and >= 32 chars in production), no callers yet. `referenceDate = '2026-09-24'`. Secrets have hard-coded local defaults |
| `db.ts`         | `appDb()` lazy singleton (better-sqlite3): sets pragmas (WAL, FK on, busy_timeout 5000) and then runs `migrate()`; `closeAppDb()`. Holds no DDL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `migrations.ts` | Ordered `migrations` and `migrate(db, list?)`: `PRAGMA user_version`, each migration in its own `db.transaction(fn).immediate()` that re-reads `user_version` inside the lock (concurrent opens are no-ops, a failure rolls back). Migration 1 is the original schema verbatim (`IF NOT EXISTS`): `meta, conversations, messages, runs, intents, approvals, incidents, events, chunks, embedding_cache` + 3 indexes                                                                                                                                                                                                                                                                                                                                                                                               |
| `auth.ts`       | `sign` (HMAC-SHA256 hex), `equal` (timing-safe), `sessionToken(userId)` -> `id.sig`, `actor(request)` parses the `banana_actor` cookie into a `Person` or throws `HttpError(401)`, `sameOrigin(request)` (Origin vs Host), `HttpError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `people.ts`     | Static roster: 8 customers (lucia, bruno, carla, diego, elena, hugo, ines, omar) and 2 operators (marta, pablo); `person(id)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `seed.ts`       | `seedApp()`: in one transaction wipes app tables, loads `fixtures/conversations.json` (conversations, messages, incidents from `case`) and one historic failed intent for lucia through the `persistence/` repos, sets `meta.seed`, then `restoreIndex` from `fixtures/embeddings/index.json.gz` if present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `telemetry.ts`  | `recordEvent(ctx, kind, data)` stores the event through `persistence/events.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `types.ts`      | `Person, Account, TransferInput, Operation, ToolContext, ActionResult, DocumentRecord, Chunk, SearchResult`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Subdirectories

| Directory    | Purpose                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| `agent/`     | OpenAI Responses loop, prompt, tool definitions (see `agent/AGENTS.md`)        |
| `banking/`   | Signed client for the bank API and transfer workflow (see `banking/AGENTS.md`) |
| `http/`      | HTTP layer behind the catch-all route (see `### http/` below)                  |
| `ingestion/` | Document chunking and index build (see `ingestion/AGENTS.md`)                  |
| `operator/`  | Operator case view (see `operator/AGENTS.md`)                                  |
| `retrieval/` | Embeddings, vector store, search (see `retrieval/AGENTS.md`)                   |

### `http/`

The transport layer: no SQL (data comes from `persistence/*` and the feature modules) and no business rules beyond role checks and body validation.

| File            | Description                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handle.ts`     | `handle(request, context)`: awaits `context.params`, `sameOrigin` for every POST, public routes, then `actor()` (401 without a session, even for an unknown path), then the route table; no match is 404 `Route not found.` (never 405); errors via `toErrorResponse` |
| `router.ts`     | `match(routes, method, segments)`: literal, `:param` and a final `*rest` pattern segment; `GET`, `POST` or `ANY`; first match wins; no match is `null`                                                                                                                |
| `routes.ts`     | `publicRoutes` (`health`, `people`, POST `session`) and `routes`, in the order of the original if-chain. Routes that are not POST-only are `ANY` on purpose (today's endpoints answer any exported method)                                                            |
| `context.ts`    | Handler types: `PublicHandler({ request, params })`, `Handler({ request, params, actor })`                                                                                                                                                                            |
| `errors.ts`     | `toErrorResponse(e, requestId?)`: `MissingOpenAIKeyError` 503 + `code`, `HttpError`/`BankError` own status, `ZodError`/`SyntaxError` 400 `Invalid request data.`, else logs only the error name and answers a generic 500. `requestId` is unused for now              |
| `respond.ts`    | `json(data, status, headers)`: `Cache-Control: no-store` merged with extra headers                                                                                                                                                                                    |
| `handlers/*.ts` | One module per resource (`health`, `people`, `session`, `dashboard`, `conversations`, `actions`, `approvals`, `incidents`, `documents`, `preview-answer`, `search`, `ingestion`); each owns its zod body schema and its role check, in the original order             |

Order quirks pinned by `app/api/[...path]/route.test.ts` (kept until the planned route-quirk cleanup): `actions` parses the body before the role check; `conversations/:id/messages` checks ownership before the body and renames the conversation before `sendMessage` runs; `preview-answer` checks the role before the body.

## For AI Agents

### Working In This Directory

- Identity comes only from the signed cookie via `actor()`; never trust a user id from the body or headers.
- Schema changes are a new migration appended to `migrations.ts` (never edit a shipped one); a new table also goes in the `seed.ts` wipe list.
- Repos prepare through `persistence/statement.ts`, which compiles each SQL text once per connection.
- SQL lives only in `persistence/*` (shared tables), `db.ts`/`migrations.ts`, `seed.ts` (wipe list, `meta`, chunk labels) and `retrieval/{store,embeddings}.ts` (`chunks`, `meta`, `embedding_cache`). Every other module calls a repo or a retrieval function.
- `db.ts` and `config.ts` read env/paths at first use; tests set `DATA_DIR` before dynamic imports.
- Things worth scrutinizing:
  - `telemetry.ts:recordEvent` persists only `{tool, status}`; arguments, outputs, errors and durations passed by callers are dropped.
  - `auth.ts`: token has no expiry; `sameOrigin` passes when no `Origin` header is sent; default secrets in `config.ts` apply if env is unset.
  - `seed.ts` deletes everything (including `meta`) - safe only for local reset.

### Testing Requirements

- `npm test` (colocated `*.test.ts`, see `TESTING.md`) covers: `loadConfig`/`assertProductionSecrets`, migrations (fresh, upgrade from an unversioned DB, rerun, rollback, two connections), one round-trip per repo writer, the frozen public import surface (`public-surface.test.ts`), `seedApp` reproducibility (47 conversations, 17 incidents, 8 closed, index >300 chunks of 1536 dims), signed-session/`sameOrigin` behaviour, and the missing-API-key search response. `npm run typecheck` for types.

### Common Patterns

- Errors surface as `HttpError(status, message)`; `http/errors.ts` maps them to JSON.
- Prepared statements with named-column inserts (`INSERT INTO t(col,...) VALUES(...)`), owned by the repo of each table; timestamps are ISO strings from `new Date().toISOString()`.

## Dependencies

### Internal

- `fixtures/` (seed data, index), `simulator/` (via HTTP only), `app/api/[...path]/route.ts` (caller of `http/handle.ts`).

### External

- `better-sqlite3`, `dotenv`, `node:crypto`, `node:zlib`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
