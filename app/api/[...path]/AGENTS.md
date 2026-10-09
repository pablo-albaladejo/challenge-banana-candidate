<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# [...path] (catch-all API)

## Purpose

Single Next.js route handler serving every `/api/*` endpoint. `route.ts` exports one `handler` as both `GET` and `POST`, runs on `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, and wraps every response in `Cache-Control: no-store`. Routing is a hand-written if-chain on `path` (the awaited `context.params.path` array).

## Key Files

| File       | Description                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `route.ts` | ~230 lines. Dispatches by `path.join('/')` and method; zod-validates bodies; central `try/catch` maps errors to JSON. |

## Route table

Auth column: "none" = before `actor()` runs; otherwise the actor is resolved from the `banana_actor` cookie.

| Route                                                  | Method                                               | Auth / role                                                     | Delegates to                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `health`                                               | any                                                  | none                                                            | `config` (models, `keyConfigured`)                                                                                                     |
| `people`                                               | any                                                  | none                                                            | `src/people.ts` list                                                                                                                   |
| `session`                                              | POST `{userId}`                                      | none                                                            | `person()` + `sessionToken()`; sets `banana_actor` cookie (HttpOnly, SameSite=Strict)                                                  |
| `session`                                              | other                                                | cookie                                                          | returns current person                                                                                                                 |
| `dashboard`                                            | any                                                  | operator: incidents list; customer: accounts/movements/contacts | `bankRequest` (`/v1/accounts`, `/v1/movements`, `/v1/contacts`) + unconsumed, unexpired `approvals` rows                               |
| `conversations`                                        | GET / POST                                           | customer only                                                   | list / insert into `conversations` (title "New conversation")                                                                          |
| `conversations/{id}`                                   | any                                                  | owner (`conversationFor`, 404 otherwise)                        | conversation + `messages` rows                                                                                                         |
| `conversations/{id}/messages`                          | POST `{content}` (1-8000)                            | owner                                                           | sets title from first message, then `sendMessage` (`src/agent/run.ts`)                                                                 |
| `actions`                                              | POST `{name, arguments, conversationId?, intentId?}` | customer                                                        | `runTool` (`src/agent/tools.ts`); `name` in `transfer_money`, `request_human`, `operation_status`, `list_accounts`, `search_documents` |
| `approvals/{id}/confirm`                               | POST                                                 | cookie user must own approval + intent                          | `transferMoney` (`src/banking/actions.ts`) with `approvalId`                                                                           |
| `incidents`, `incidents/{id}`                          | any                                                  | operator                                                        | `incidents` table / `caseDetail` (`src/operator/view.ts`)                                                                              |
| `documents`, `documents/{id}`, `documents/{id}/chunks` | any                                                  | any actor; non-operators see only `audience === 'public'`       | `documents()`, `readDocument`, `allChunks()` (vectors stripped)                                                                        |
| `preview-answer`                                       | POST `{question, sources<=10}`                       | operator                                                        | `answerWithEvidence` (`src/agent/run.ts`)                                                                                              |
| `search`                                               | POST `{query}` (1-2000)                              | any actor                                                       | `searchDocuments(query, role)`                                                                                                         |
| `ingestion`                                            | POST                                                 | operator                                                        | `ingest()` (re-embeds documents)                                                                                                       |
| anything else                                          | -                                                    | -                                                               | 404 `Route not found.`                                                                                                                 |

## For AI Agents

### Working In This Directory

- Session/actor (`src/auth.ts`): cookie value is `userId.HMAC-SHA256(userId, config.sessionSecret)`; `actor()` verifies with `timingSafeEqual`, else `HttpError(401)`. `sessionSecret` defaults to `'banana-local-session'` if `SESSION_SECRET` is unset. There is no login: `POST session` accepts any known `userId`.
- CSRF: `sameOrigin()` runs for every POST and only rejects when an `Origin` header exists and its host differs from `Host`. Requests without `Origin` pass.
- Error mapping (catch block): `MissingOpenAIKeyError` -> 503 `{code:'missing_openai_api_key'}`; `HttpError`/`BankError` -> own status and message; `ZodError`/`SyntaxError` -> 400 `Invalid request data.`; anything else -> 500 generic message (logs only `e.name`).
- Add a route as another `if` branch before the final 404, check the role explicitly, validate with zod, and throw `HttpError`. Next 16 passes `params` as a Promise; keep `await context.params`.
- Ownership is by SQL (`WHERE ... user_id=?`) or `conversationFor`; account ownership for transfers is checked in `src/banking/authorization.ts`.

### Testing Requirements

- `npm test` (sibling `route.test.ts`, conventions in `TESTING.md`), `npm run typecheck`, `npm run build` (webpack).
- Manual with `npm run dev` (http://127.0.0.1:3000; bank simulator via `npm run bank`): e.g. `curl -i -X POST localhost:3000/api/session -H 'content-type: application/json' -d '{"userId":"lucia"}'` and reuse the cookie. Chat/search/ingestion need `OPENAI_API_KEY`.

### Common Patterns

- Helper `json(data, status, headers)` for all responses.
- `conversationFor(id, userId)` for owned-conversation lookup.
- Multiple `const` declarations chained with commas (`const current = actor(request), db = appDb()`).

### Things worth scrutinizing

- `approvals/{id}/confirm` (route.ts ~135-156): selects the approval by id and user but does not check `consumed_at` or `expires_at` itself, and runs `transferMoney` on the stored payload; any single-use/expiry enforcement must live in `src/banking/*`. Note `authorizeTransfer` currently always returns `null` (never `requires_confirmation`), so nothing in this repo path obviously creates approvals.
- `actions` (~110-134): `arguments` is `z.unknown()`; a client-supplied `intentId` is reused as the idempotency key. `search_documents` via `runTool` is called without the actor's role.
- `search` and `documents*`: authz depends on `current.role`; `documents/{id}/chunks` is only role-filtered through `visible` (verify no internal chunk leak via `search`).
- `preview-answer`: operator-only, but `sources` are fully client-supplied and fed to the model.
- `session` POST: no credential check; cookie lacks `Secure`; weak default secret.
- `dashboard` for operators returns all incidents; `incidents/{id}` is not scoped to an operator's assignment; `caseDetail` returns empty `history`/`events`/`intents`/`bank`.
- Auth runs after `health`/`people`/`session`, but GET requests skip `sameOrigin`.

## Dependencies

### Internal

- `src/auth.ts`, `src/people.ts`, `src/db.ts` (`appDb`), `src/config.ts`, `src/banking/{client,actions}.ts`, `src/agent/{run,tools}.ts`, `src/operator/view.ts`, `src/ingestion/pipeline.ts`, `src/retrieval/{search,embeddings,store}.ts`.

### External

- `zod` (request validation), `node:crypto` (`randomUUID`), Next.js route handler runtime; downstream: `better-sqlite3`, `openai`, bank simulator.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
