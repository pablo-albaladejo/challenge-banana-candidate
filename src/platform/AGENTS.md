<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-10 -->

# platform

## Purpose

Shared technical plumbing every feature builds on, with no business rules of its own: configuration, crypto primitives, the app database (connection, migrations, prepared statements), the bank client and port, the model gateway, the HTTP primitives and telemetry. Features depend on `platform/`; `platform/` imports no feature and not `src/server/` (enforced in `eslint.config.mjs`, static and dynamic imports).

## Key Files

| File        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts` | Loads `.env.local` then `.env` (dotenv). `loadConfig(env)` is pure and never throws; `config = loadConfig(process.env)` is mutable on purpose (tests change keys at runtime, so modules read `config.x` at call time and never destructure it) with keys `dataDir, bankDataDir, bankUrl, bankPort, appPort, serviceSecret, adminSecret, sessionSecret, chatModel, embeddingModel, bankTimeoutMs` (env: `DATA_DIR`, `BANK_DATA_DIR`, `BANK_URL`, `BANK_PORT`, `APP_PORT`, `BANK_SERVICE_SECRET`, `BANK_ADMIN_SECRET`, `SESSION_SECRET`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`, `BANK_TIMEOUT_MS` default 1400). `assertProductionSecrets(config, nodeEnv)`: pure check (secrets set and >= 32 chars in production), no callers yet. `referenceDate = '2026-09-24'`. Secrets have hard-coded local defaults. Frozen at `src/config.ts` (a shim that re-exports the same `config` object) |
| `crypto.ts` | `sign(value, secret)` (HMAC-SHA256, hex) and `equal(a, b)` (constant-time string compare). Used by `bank/client.ts` and `identity/auth.ts`; re-exported by `identity` (frozen `src/auth.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### `db/`

| File            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db.ts`         | `appDb()` lazy singleton (better-sqlite3): sets pragmas (WAL, FK on, busy_timeout 5000) and then runs `migrate()`; `closeAppDb()`. Holds no DDL. Frozen at `src/db.ts` (shim)                                                                                                                                                                                                                                                                                                                                   |
| `migrations.ts` | Ordered `migrations` and `migrate(db, list?)`: `PRAGMA user_version`, each migration in its own `db.transaction(fn).immediate()` that re-reads `user_version` inside the lock (concurrent opens are no-ops, a failure rolls back). Migration 1 is the original schema verbatim (`IF NOT EXISTS`): `meta, conversations, messages, runs, intents, approvals, incidents, events, chunks, embedding_cache` + 3 indexes; migration 2 adds the nullable `intents.dispatched_at`. Raw SQL only: it imports no feature |
| `statement.ts`  | `statement(sql)` compiles each SQL text once per connection; `atomically(step)` runs a synchronous step as one `BEGIN IMMEDIATE` transaction (rolled back if it throws)                                                                                                                                                                                                                                                                                                                                         |

### `bank/`

| File        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts` | `bankRequest<T>(userId, path, method='GET', body?)`: HMAC-signs `method\npath\nuserId\ntimestamp\nbody` with `BANK_SERVICE_SECRET`; sends `x-bank-actor`, `x-bank-time`, `x-bank-signature`; aborts after `BANK_TIMEOUT_MS` (default 1400) -> `BankError(504)`; non-2xx -> `BankError(status, data.error)`; a body that cannot be read (not JSON, empty, cut off while streaming) -> `BankError(ok ? 502 : max(status, 502), 'Unreadable bank response.')`, so it counts as unverified (retried, `unknown`) and no parser message leaks. `BankError`. Frozen at `src/banking/client.ts` (shim) |
| `bank.ts`   | The bank port, one function per endpoint the app uses: `accounts`, `contacts`, `movements` (GET `/v1/...`), `transfer(userId, input, reference)` (POST `/v1/transfers`), `operation(userId, reference)` (GET `/v1/operations/:reference`, `encodeURIComponent`), `operatorCustomer(operatorId, customerId)` (GET `/v1/operator/customer?id=`). The only callers of `bankRequest` besides tests                                                                                                                                                                                                 |

### `model/`

The model gateway: the only module that builds an OpenAI client or calls the provider (`new OpenAI`, `.responses.create`, `.embeddings.create` appear nowhere else outside tests).

| File         | Description                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway.ts` | `openai()` builds a client per call (`maxRetries: 2`, `timeout: 45000`; throws `MissingOpenAIKeyError` when `OPENAI_API_KEY` is blank). `createResponse(body)` and `createEmbeddings(body)` are pass-throughs to the Responses and Embeddings APIs. `knowledge/search/embeddings.ts` re-exports `openai` and `MissingOpenAIKeyError` (frozen surface) |

### `http/`

The transport primitives: no SQL and no business rules. Feature handlers live in each feature's `http/`; `src/server/routes.ts` wires them and `src/server/handle.ts` dispatches.

| File            | Description                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `router.ts`     | `match(routes, method, segments)`: literal and `:param` segments, exact length (no trailing segments); `GET` or `POST`, HEAD matches GET; first match wins; no match is `null`. `allowedMethods(routes, segments)`: the distinct methods of the routes matching the path, HEAD beside GET, sorted (the 405 `Allow`) |
| `context.ts`    | Handler types: `PublicHandler({ request, params })`, `Handler({ request, params, actor })`                                                                                                                                                                                                                          |
| `http-error.ts` | `HttpError(status, message)`: the error every handler throws. Re-exported by `identity` (and the frozen `src/auth.ts`), so it is one class for every importer                                                                                                                                                       |
| `errors.ts`     | `toErrorResponse(e, requestId?)`: `MissingOpenAIKeyError` 503 + `code`, `HttpError`/`BankError` own status, `ZodError`/`SyntaxError` 400 `Invalid request data.`, else logs only the error name and answers a generic 500. `requestId` is unused for now                                                            |
| `respond.ts`    | `json(data, status, headers)`: `Cache-Control: no-store` merged with extra headers                                                                                                                                                                                                                                  |
| `health.ts`     | `health` (`GET health`, public)                                                                                                                                                                                                                                                                                     |

### `telemetry/`

| File             | Description                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| `telemetry.ts`   | `recordEvent(ctx, kind, data)` stores the event through `events.repo.ts` |
| `events.repo.ts` | The `events` table: `insertEvent`, `eventsIn(conversationId)`            |

## For AI Agents

### Working In This Directory

- Dependency direction: nothing here imports `src/{transfers,accounts,assistant,conversations,knowledge,support,identity}` or `src/server/`, statically or with `import()`; ESLint has no exceptions. Shared primitives a feature also needs (`sign`/`equal`, `HttpError`) live here and the feature re-exports them.
- Schema changes are a new migration appended to `db/migrations.ts` (never edit a shipped one); a new table also goes in the `../server/seed.ts` wipe list.
- SQL lives only in the feature repos (`*.repo.ts`), `db/` and `knowledge/search/{store,embeddings}.ts`.
- `db/db.ts` and `config.ts` read env/paths at first use; tests set `DATA_DIR` before dynamic imports.
- Things worth scrutinizing:
  - `telemetry/telemetry.ts:recordEvent` persists only what callers pass in `data`.
  - `bank/client.ts`: an unreadable non-2xx counts as >= 502 (`unknown`), the safe direction: it is retried and reconciled, never reported as a definitive failure.

### Testing Requirements

- Sibling tests: `config.test.ts`, `db/{db,migrations,statement}.test.ts`, `bank/{client,bank}.test.ts` (real bank over HTTP; never mock `bankRequest`), `model/gateway.test.ts` (fake OpenAI), `http/{router,errors,respond}.test.ts` (`errors.test.ts` also covers `HttpError`), `telemetry/{telemetry,events.repo}.test.ts`.

### Common Patterns

- Prepared statements with named-column inserts, owned by the repo of each table; timestamps are ISO strings from `new Date().toISOString()`.

## Dependencies

### Internal

- `../types` only.

### External

- `better-sqlite3`, `dotenv`, `openai`, `zod`, global `fetch`, `node:crypto`, `node:zlib`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
