<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# src

## Purpose

Application core, imported by the Next.js catch-all route (`app/api/[...path]/route.ts`, which delegates to `server/handle.ts`), `scripts/`, and `tests/`. The tree screams the business: one folder per feature (`transfers`, `accounts`, `assistant`, `conversations`, `knowledge`, `support`, `identity`), each owning its logic, repos, agent tools and HTTP handlers, on top of `platform/` (config, crypto, app DB, bank client, model gateway, HTTP primitives, telemetry). `server/` is the composition root that wires them together. Everything here uses the **app DB** (`<DATA_DIR>/app.sqlite`); bank state lives behind HTTP in the simulator (`simulator/`), reached only via the port `platform/bank/bank.ts` over the signed `platform/bank/client.ts`.

## Key Files

| File                     | Description                                                                                                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`               | `Person, Account, TransferInput, Operation, ToolContext` (with the UI-only `overridePendingIntentId`), `ActionResult` (includes `RequiresReviewResult`: `{ status: 'requires_review', pendingIntentId, intentId, error }`), `DocumentRecord, Chunk, SearchResult`. Shared by every folder |
| `public-surface.test.ts` | Pins the frozen import paths and their exports (see "Frozen paths" below)                                                                                                                                                                                                                 |

## Subdirectories

| Directory                                        | Purpose                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transfers/`                                     | Transfer workflow: intents, approvals, authorization, dispatch, reconcile; `transfer_money` and `operation_status` tools; `actions` and `approvals` endpoints (see `transfers/AGENTS.md`) |
| `accounts/`                                      | Customer dashboard and the `list_accounts` tool (see `accounts/AGENTS.md`)                                                                                                                |
| `assistant/`                                     | Conversation, model ↔ tool loop, prompt, tool registry, runs; `preview-answer` endpoint (see `assistant/AGENTS.md`)                                                                       |
| `conversations/`                                 | Conversations and messages: repos and endpoints (see `conversations/AGENTS.md`)                                                                                                           |
| `knowledge/`                                     | Ingestion, embeddings, vector store, search; `search_documents` tool; `search`, `documents`, `ingestion` endpoints (see `knowledge/AGENTS.md`)                                            |
| `support/`                                       | Support cases and the operator case view; `request_human` tool; `incidents` endpoints (see `support/AGENTS.md`)                                                                           |
| `identity/`                                      | People roster, signed session, actor, same-origin check; `people` and `session` endpoints (see `identity/AGENTS.md`)                                                                      |
| `platform/`                                      | Config, crypto (`sign`, `equal`), app DB (migrations, statements), bank client and port, model gateway, HTTP primitives (`HttpError`), telemetry (see `platform/AGENTS.md`)               |
| `server/`                                        | The composition root: `routes.ts`, `handle.ts`, `seed.ts` (see `server/AGENTS.md`)                                                                                                        |
| `agent/`, `banking/`, `ingestion/`, `retrieval/` | Frozen re-export shims only (see below); no code lives here                                                                                                                               |

### Frozen paths

`public-surface.test.ts` freezes these import paths for the simulator, scripts and external checks. Each is a thin `export *` (or named) re-export of the module's new home, so the exported names and object identities are unchanged (`config` stays the same mutable object). No application code imports them; new code imports the new paths.

| Frozen path               | Re-exports                                                     |
| ------------------------- | -------------------------------------------------------------- |
| `config.ts`               | `platform/config.ts`                                           |
| `db.ts`                   | `platform/db/db.ts`                                            |
| `seed.ts`                 | `server/seed.ts`                                               |
| `auth.ts`                 | `identity/auth.ts`                                             |
| `people.ts`               | `identity/people.ts`                                           |
| `banking/client.ts`       | `platform/bank/client.ts`                                      |
| `banking/actions.ts`      | `transfers/transfer-money.ts`                                  |
| `ingestion/pipeline.ts`   | `knowledge/ingestion/pipeline.ts`                              |
| `retrieval/store.ts`      | `knowledge/search/store.ts`                                    |
| `retrieval/embeddings.ts` | `knowledge/search/embeddings.ts`                               |
| `agent/run.ts`            | `sendMessage`, `answerWithEvidence` from `assistant/`          |
| `agent/tools.ts`          | `toolDefinitions`, `runTool` from `assistant/tool-registry.ts` |

## For AI Agents

### Working In This Directory

- **Dependency rules** (enforced in `eslint.config.mjs`; `npm run lint` fails on a violation):
  - Features depend on `platform/` (any file inside it). `platform/` is the bottom layer: it imports no feature and not `server/`, statically or with `import()`.
  - A feature imports another feature only through its `index.ts` (`'../transfers'` or `'../transfers/index.ts'`, never `'../transfers/reconcile'`), statically or with `import()`. Inside a feature, import relatively.
  - `server/` is the composition root: the only module that deep-imports feature internals (the `http/` handlers, which no `index.ts` exports). No feature imports `server/` outside tests (feature tests may call `server/seed`); nothing in `app/`, `scripts/` or `tests/` imports a feature's `http/`.
  - Nothing under `src/` (outside the shims themselves) imports a frozen shim (`../config`, `../agent/...`, ...) or the `@/src/` alias.
  - Each feature owns its agent tools (`<feature>/tools/<name>.tool.ts`, exported through its `index.ts`); `assistant/tool-registry.ts` assembles them. A tool takes only types from `assistant` (`import type { Tool }`; `@typescript-eslint/no-restricted-imports` with `allowTypeImports`).
- **No runtime import cycles.** The tool registry imports the tools of `accounts`, `knowledge`, `transfers` and `support`; the tools import the `Tool` type back, which TypeScript erases, so there is no runtime edge from a tool to `assistant`. `conversations` keeps `conversationFor` in `ownership.ts`, so `conversations/index.ts` loads only its repos and never reaches `assistant`, the registry or the model gateway; the feature `http/` handlers are loaded only by `server/routes.ts`. Keep it that way: a value import from a tool to `assistant`, or from an `index.ts` to its own `http/`, would bring the cycle back.
- Identity comes only from the signed cookie via `actor()`; never trust a user id from the body or headers.
- Repos (`*.repo.ts`) prepare through `platform/db/statement.ts`, which compiles each SQL text once per connection. Its `atomically(step)` runs a synchronous step as one `BEGIN IMMEDIATE` transaction (rolled back if it throws); `authorizeTransfer` uses it to check twins, consume the approval and claim `processing` in one step.
- Intent status changes go only through `transfers/intent-lifecycle.ts:transition`, a compare-and-set that rejects edges outside `TRANSITIONS` (`IllegalTransitionError`); `UPDATE intents` appears only in `transfers/intents.repo.ts`.
- The customer dashboard (`accounts/http/dashboard.ts`) reconciles up to 10 of the customer's intents on every load: the newest `unknown`/`processing` ones first, then `failed` ones with a bank reference from the last 24 h, and returns them as `pendingTransfers`.
- SQL lives only in the repos (`*.repo.ts`: shared tables), `platform/db/` (`db.ts`, `migrations.ts`), `server/seed.ts` (wipe list, `meta`) and `knowledge/search/{store,embeddings}.ts` (`chunks`, `meta`, `embedding_cache`). Every other module calls a repo or a knowledge function.
- HTTP handlers own their zod body schema and role check. Check order pinned by `app/api/[...path]/route.test.ts`: `actions` and `preview-answer` check the role before the body; `conversations/:id/messages` checks ownership before the body and renames the conversation before `sendMessage` runs.
- Things worth scrutinizing:
  - `platform/telemetry/telemetry.ts:recordEvent` persists only what callers pass.
  - `identity/auth.ts`: token has no expiry; `sameOrigin` passes when no `Origin` header is sent; default secrets in `platform/config.ts` apply if env is unset.
  - `server/seed.ts` deletes everything (including `meta`) - safe only for local reset.

### Testing Requirements

- `npm test` (colocated `*.test.ts`, see `TESTING.md`) covers every feature and `platform/` module, the frozen public import surface (`public-surface.test.ts`) and, through `app/api/[...path]/route.test.ts`, every `http/` handler, `server/routes.ts` and `server/handle.ts`. `npm run typecheck` for types; `npm run lint` for the dependency rules.

### Common Patterns

- Errors surface as `HttpError(status, message)` (`platform/http/http-error.ts`, re-exported by `identity`); `platform/http/errors.ts` maps them to JSON.
- Prepared statements with named-column inserts (`INSERT INTO t(col,...) VALUES(...)`), owned by the repo of each table; timestamps are ISO strings from `new Date().toISOString()`.

## Dependencies

### Internal

- `fixtures/` (seed data, index), `simulator/` (via HTTP only), `app/api/[...path]/route.ts` (caller of `server/handle.ts`).

### External

- `better-sqlite3`, `dotenv`, `openai`, `zod`, `node:crypto`, `node:zlib`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
