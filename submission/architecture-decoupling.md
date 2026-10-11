# Plan: architecture decoupling (revision 2, execution-ready)

**Status: pending approval (consensus reached: Architect SOUND, Critic APPROVE after iteration 2)** · Mode: RALPLAN consensus, SHORT (with a light pre-mortem because the money path is touched) · Date: Sat 2026-10-10, deadline Monday
Supersedes the draft in `submission/architecture-decoupling.md`, which is updated to match this plan once it is approved.

Goal: separate transport (HTTP), application services, persistence and external integrations (bank, model), so that each readiness finding in `submission/production-readiness.md` and the Part 2 feature lands in one obvious module, and `route.ts` / `run.ts` stop growing.

Fixed user decisions (not reopened here): all 5 phases, refactor first; feature-first layout; plain functions, no classes/DI/MCP; `simulator/` and `fixtures/` untouched; tests hit the real bank and never mock `bankRequest`; behaviour-preserving (readiness fixes come later, with TDD); one commit per phase with green husky gates (`lint`, `format:check`, `typecheck`; pre-push `npm test` + `npm run test:e2e`); `TESTING.md` conventions; tests colocated, so a test moves with its source.

---

## 1. RALPLAN-DR summary

### Principles

1. **Pin behaviour before moving structure.** Every phase starts green against the old code with characterization tests. The same tests, with import-path changes only, are green afterwards.
2. **One owner per concern.** Each SQL statement belongs to a repo or to the module that owns its table, each bank call to the bank port, each model call to the gateway, each intent status write to `transition()`, and each route to one handler.
3. **Use the smallest seam that unlocks a finding.** No abstraction goes in unless a readiness finding or the Part 2 feature needs it (section 6).
4. **The harness is an oracle, not a client of the code under test.** `tests/support/db.ts` keeps raw SQL and never uses the new repos.
5. **External paths are frozen and every phase is reversible.** Import paths that callers outside the refactor use (the simulator, scripts, possibly the graders' checks) keep their names and exports. Each phase is one commit, and every database stays readable by the previous commit.

### Decision drivers (top 3)

1. **Characterization stays valid.** `route.test.ts` (62 cases), `tests/support/api.ts`, `tests/support/network.ts`, and every public import path keep working unchanged.
2. **Wire compatibility.** HTTP status codes, response shapes (snake_case rows), cookies and headers stay identical, and so does the request body sent to OpenAI (tool definitions included).
3. **Landing zones for the readiness fixes, inside the Monday budget.** P0-1..P0-6 and P1-x each become a local change in one module, and the whole refactor fits about 18 h (section 3).

### Decisions and options

**D1. HTTP routing**

| Option                                                                   | Pros                                                                                                                                                                                             | Cons                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Route table in `src/http/` behind the existing catch-all (chosen)** | `route.test.ts` and `api.ts` untouched; one place for `sameOrigin`, actor and error mapping (later also the Host allowlist, requestId and rate limit); today's method semantics are reproducible | Hand-rolled matcher (~40 lines) that needs its own tests; no Next-native 405                                                                                                                                            |
| B. Next file-based route handlers per resource                           | Native convention, typed `RouteContext`                                                                                                                                                          | ~15 route files; `api.ts` must re-implement Next routing; cross-cutting concerns duplicated; Next answers 405 for unexported methods where the app answers 404 today (`15-route-handlers.md`, "Supported HTTP Methods") |

B loses on drivers 1 and 2.

**D2. Persistence**

| Option                                                                                                                                  | Pros                                                                                                                                                                            | Cons                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **A. Repos only for the shared transactional tables, in `src/persistence/`; `src/db.ts` keeps the connection and `migrate()` (chosen)** | Shared tables (intents: banking, operator, dashboard; messages: agent, operator, http) get one owner each; `src/db.ts` stays at its public path; retrieval keeps its own tables | Two places hold SQL: `persistence/` and the retrieval modules                                                                      |
| B. A repo for every table under `src/db/` (revision 1)                                                                                  | Uniform                                                                                                                                                                         | Moves the frozen `src/db.ts` path; adds 3 repos (chunks, meta, embedding_cache) with no finding behind them (violates Principle 3) |
| C. Keep SQL in services and only add migrations                                                                                         | Smallest diff                                                                                                                                                                   | P2-2 (positional inserts) stays open and SQL stays scattered                                                                       |

**D3. Tool JSON schemas**

| Option                                                                                                      | Pros                                           | Cons                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Derive with `z.toJSONSchema` plus a strict normalizer, pinned by a string-equal golden test (chosen)** | One source of truth; adding a tool is one file | Raw output differs from today's wire (verified: it adds `$schema`, `minLength`, `maxLength`, `exclusiveMinimum` and `maximum`), so a normalizer is required |
| B. Hand-written JSON next to each zod schema, plus an equivalence test                                      | Full manual control of the wire                | Two sources of truth                                                                                                                                        |
| C. Raw `z.toJSONSchema` output                                                                              | Least code                                     | Changes the model request; strict mode may reject `minLength`/`maxLength`                                                                                   |

The normalizer:

- keeps only `type`, `properties`, `required`, `additionalProperties`, `items`, `enum` and `description`;
- emits keys in the order of `tools.ts:10-15`: `type`, `properties`, `required`, `additionalProperties`;
- always emits `required`, including `required: []` for an empty object (`list_accounts`);
- forces `additionalProperties: false` and drops `$schema`;
- throws on optional fields, which strict mode needs to be required.

**D4. Intent lifecycle**

| Option                                                                                                                                                                              | Pros                                                                                                                                                 | Cons                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Observed-transitions table (data) plus one `transition(id, to, fields)` writer. It writes unconditionally (`WHERE id=?`, as today) and returns `{ changed, legal }` (chosen)** | The lifecycle can be read in one place; the table documents today's real edges; enforcement is a later one-line change made with TDD in the P0 block | Phase 3 enforces nothing; `legal` is informational only, so an illegal edge is still written, exactly as today                                                                     |
| B. A conditional `UPDATE … WHERE status IN (from)` now (revision 1)                                                                                                                 | Enforcement now                                                                                                                                      | Changes behaviour inside a refactor. A concurrent re-proposal during dispatch (`processing → requires_confirmation`) would stop being written, and no existing test pins that race |
| C. One function per transition                                                                                                                                                      | Explicit fields per transition                                                                                                                       | The lifecycle is spread over N functions; no single table to review                                                                                                                |

`legal` is only a return value: no event, no log, no throw. Tests count `events()`, so phase 3 adds no events.

**D5. Config**

| Option                                                                                                                                                                                      | Pros                                                                                                                                                                      | Cons                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **A. A pure `loadConfig(env)` that never throws, a mutable `config = loadConfig(process.env)` with the same keys, and a separate pure `assertProductionSecrets(config, nodeEnv)` (chosen)** | P1-5 and P2-4 become testable; `network.ts`, `bank.ts`, the 5 tests that mutate config, and the simulator (`simulator/{server,db}.ts` import `config`) all stay untouched | `config` stays mutable (documented as test-only mutation) |
| B. A frozen config plus `withConfig()`                                                                                                                                                      | Immutability                                                                                                                                                              | Harness churn without a finding behind it                 |

**D6. Model gateway location**

| Option                                                                                                            | Pros                                                                                                       | Cons                                      |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **A. `src/model/gateway.ts`; `retrieval/embeddings.ts` re-exports `openai` and `MissingOpenAIKeyError` (chosen)** | Retrieval and agent both depend on it, with no retrieval → agent import; `scripts/doctor.ts` keeps working | One more top-level folder                 |
| B. `src/agent/model.ts`                                                                                           | Fewer folders                                                                                              | Inverts the dependency: retrieval → agent |

**D7. UI split**

| Option                                                                                                          | Pros                                                       | Cons                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **A. State and every async handler in `Home`; presentational panels in the private folder `app/_ui/` (chosen)** | The `generation` stale-result guard stays in one component | `page.tsx` stays at up to ~450 lines                                                                                             |
| B. Custom hooks per area                                                                                        | Smaller page                                               | Moves async state and the guard: real behaviour risk with no UI unit tests                                                       |
| C. Route group `app/(ui)/`                                                                                      | —                                                          | Route groups are for routing; `_folder` is the documented non-routable colocation (`02-project-structure.md`, "Private folders") |

---

## 2. Frozen public surface and target layout

**Frozen paths.** Their names and exports do not change, because the starter's `git show 726b592:tests/invariants.test.ts` imported them, `simulator/*` imports some of them, and the graders run automated checks (`docs/challenge.md:78`):

| Path                                  | Exports that must stay                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `src/db.ts`                           | `appDb`, `closeAppDb`                                                         |
| `src/config.ts`                       | `config` (all current keys, including `adminSecret`), `referenceDate`         |
| `src/auth.ts`                         | `sign`, `equal`, `sessionToken`, `actor`, `sameOrigin`, `HttpError`           |
| `src/people.ts`                       | `people`, `person`                                                            |
| `src/types.ts`                        | all types (used by the simulator)                                             |
| `src/seed.ts`                         | `seedApp`                                                                     |
| `src/ingestion/pipeline.ts`           | `documents`, `readDocument`, `ingest`                                         |
| `src/retrieval/store.ts`              | `allChunks` (+ current exports)                                               |
| `src/retrieval/embeddings.ts`         | current exports, including `openai` and `MissingOpenAIKeyError` (re-exported) |
| `src/banking/client.ts`, `actions.ts` | `bankRequest`, `BankError`, `transferMoney`, `transferSchema`                 |
| `src/agent/run.ts`                    | `sendMessage`, `answerWithEvidence` (re-export shim)                          |
| `src/agent/tools.ts`                  | `toolDefinitions`, `runTool` (re-export shim)                                 |
| `app/api/[...path]/route.ts`          | `GET`, `POST` (+ `runtime`, `dynamic`)                                        |

`src/public-surface.test.ts` (new, phase 1, extended in phases 2 and 4) imports every frozen path and asserts that each listed export is defined.

```
src/
  config.ts            loadConfig(env) (pure, never throws), mutable config, assertProductionSecrets(config), referenceDate
  db.ts                appDb(), closeAppDb(): connection + migrate()
  migrations.ts        ordered migrations; PRAGMA user_version
  persistence/         conversations.ts messages.ts runs.ts intents.ts approvals.ts incidents.ts events.ts
  http/
    handle.ts          sameOrigin → public routes → actor → match → handler; errors
    router.ts          match(method, segments): :param, trailing *rest, GET | POST | ANY
    routes.ts          the table (order mirrors today's if-chain)
    errors.ts          toErrorResponse(e, requestId?)
    respond.ts         json() with Cache-Control: no-store
    handlers/          health people session dashboard conversations actions approvals incidents documents preview search ingestion
  banking/  client.ts bank.ts (port) intents.ts (TRANSITIONS, transition) actions.ts authorization.ts dispatch.ts reconcile.ts
  model/    gateway.ts (openai, MissingOpenAIKeyError, createResponse, createEmbeddings)
  agent/
    run.ts             shim → conversation.ts, evidence.ts
    tools.ts           shim → tools/registry.ts
    conversation.ts    sendMessage: ownership, lock, run/messages persistence, retrieval, error text
    loop.ts            runLoop: model ↔ tool rounds, no direct SQL
    evidence.ts        answerWithEvidence
    tools/  registry.ts strict-schema.ts list-accounts.ts search-documents.ts transfer-money.ts operation-status.ts request-human.ts
  retrieval/ store.ts, embeddings.ts keep chunks/meta/embedding_cache SQL (positional inserts fixed in place)
app/api/[...path]/route.ts   ~15 lines → handle()
app/page.tsx                 Home: state, effects, handlers, composition
app/_ui/                     api.ts format.ts Icon.tsx Sidebar.tsx CustomerOverview.tsx Chat.tsx TransferForm.tsx
                             ApprovalsPanel.tsx OperatorInbox.tsx CaseDetail.tsx Documents.tsx
```

`migrations.ts` sits at `src/` next to `db.ts` so that `src/db.ts` keeps its path.

References: model gateway as its own architecture step (Book 3 · Ch 10, step 3); tool and agent registry (Book 5 · Ch 10, p. 345); tool definitions (Book 2 · Ch 8).

---

## 3. Phases

### Common gates for every phase

1. **Test-preservation gate.** Replaces revision 1's grep. Before the phase:
   ```
   node --import tsx --import ./tests/setup.ts --test-global-setup=./tests/global-setup.ts \
     --test-reporter=tap --test "app/**/*.test.ts" "src/**/*.test.ts" "simulator/**/*.test.ts" \
     | grep -E '^[[:space:]]*(not )?ok [0-9]+ - ' | sed -E 's/^[[:space:]]*(not )?ok [0-9]+ - //' \
     | sed -E 's/ # .*$//' | sort > .omc/state/tests-before.txt
   ```
   After the phase, run the same command into `tests-after.txt`, then `comm -23 tests-before.txt tests-after.txt` must be empty, so only additions are allowed.
   - The reporter counts tests generated in loops, so the counts come from runs, not source.
   - Baseline from the reporter: **252 tests / 55 suites** (257 is the count of `it(` call sites in source). Every phase asserts `after ≥ before + new tests` on the reporter count.
   - Portable on BSD (macOS) and GNU sed: `[[:space:]]`, never `\s` or `\w`.
   - The comparison is on leaf `it` names only. The 3 duplicate leaf names are safe: `comm` on sorted input matches repeated lines pair by pair.
2. Then run `npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:e2e`.
3. Phases 2 and 5 also run `npm run build`. `next build` validates route-file exports and client boundaries, and husky never runs it.
4. Run the config-destructuring check `grep -rnE "const \{[^}]+\} = config" src app`. It must find nothing: modules read `config.x` at call time, so test mutations take effect.
5. Commit, with `TESTING.md` "Current map" and the `AGENTS.md` of each touched directory updated in the same commit.

Moved test blocks carry their `before`/`after`/`beforeEach` hooks (`startBank`/`stopBank`/`resetBank`, `startFakeOpenAI`/`close`, `seedApp`) verbatim.

### Effort and stop rule

| Phase                           | Estimate | Cumulative |
| ------------------------------- | -------: | ---------: |
| 1 Config + persistence          |      4 h |        4 h |
| 2 HTTP layer                    |      4 h |        8 h |
| 3 Banking port + lifecycle      |      3 h |       11 h |
| 4 Agent gateway, registry, loop |      4 h |       15 h |
| 5 UI split                      |      3 h |   **18 h** |

- **Stop rule:** a phase that exceeds 1.5× its estimate pauses, and the executor asks the user how to continue.
- **Go/no-go checkpoint after phase 3:** report the time spent against 11 h to the user, along with the remaining budget before Monday. The checkpoint does not drop scope by itself; the user decides.

### Phase 1 — Config and persistence foundation (4 h)

**New tests, written first:**

- `src/config.test.ts`:
  - `loadConfig`: defaults, env overrides, `BANK_DATA_DIR` falling back to `DATA_DIR`, numeric parsing, absolute paths, never throws on empty env.
  - `assertProductionSecrets` (the pure check, no callers yet): passes outside production, rejects missing or short secrets in production.
- `src/migrations.test.ts`:
  1. A fresh DB reaches the latest `user_version`.
  2. A v0 DB built with today's DDL and rows upgrades without loss.
  3. A second run is a no-op.
  4. A failing migration rolls back and leaves `user_version` unchanged.
  5. Two connections migrating the same file: the second is a no-op.

  Each migration runs in `db.transaction(fn).immediate()` and re-reads `PRAGMA user_version` inside the transaction. Migration 1 is today's DDL verbatim (`IF NOT EXISTS`). Pragmas are set before any transaction.

- `src/persistence/{conversations,messages,runs,intents,approvals,incidents,events}.test.ts`: one round-trip `it` per writer (named-column insert, then read back), plus the conditional approval consume, which returns `changes`.
  - The intents insert accepts **any status**: `seed.ts:47` inserts `failed` and `persistIntent` inserts arbitrary statuses.
  - Repos return `SELECT *` rows wherever the row reaches a client.
- `src/public-surface.test.ts`: the frozen table in section 2.

**Edited:**

- `src/db.ts`: calls `migrate(db)`; its DDL moves into migration 1.
- SQL replaced by repo calls in `route.ts`, `agent/run.ts`, `agent/tools.ts`, `banking/{actions,authorization,dispatch,reconcile}.ts`, `telemetry.ts`, `operator/view.ts`, `seed.ts` (inserts through repos; the wipe list and `meta` SQL stay).
- `retrieval/{store,embeddings}.ts`: positional inserts become named-column inserts, fixed in place.
- `tests/fixtures/factories.ts`: `persistIntent` becomes a named-column insert.
- No other test files change, because `src/db.ts` keeps its path.

**Acceptance:**

- Only allowed SQL: outside `src/persistence/**`, `src/db.ts`, `src/migrations.ts`, `src/seed.ts` and `src/retrieval/{store,embeddings}.ts`, the check `grep -rnE "\.prepare\(|\.exec\(" src app --include=*.ts | grep -v '\.test\.ts'` returns nothing.
- No `INSERT INTO [A-Za-z_]+ VALUES` remains in `src/` (`grep -rnE 'INSERT INTO [A-Za-z_]+ VALUES' src`).
- A copy of a pre-phase `.data/app.sqlite` opens with `user_version = 1` and the same row counts.
- The test-preservation gate is green.

Docs: `src/AGENTS.md` lists the new `src/migrations.ts` (beside `src/db.ts`) and `src/persistence/`.

**Unlocks:** P2-2, P2-4, P1-5.
**Rollback:** `git revert`. Old code ignores `user_version`.

### Phase 2 — HTTP layer (4 h)

> **Superseded after phase 2 (decision 4, §8).** The route-quirk cleanup changed these semantics on purpose. Methods are now explicit, and HEAD is answered as GET. A known path with another method returns 405 with `Allow`, and trailing segments return 404. `actions` now checks the role before the body. `ANY` and `*rest` are gone. Cases 4, 5 and 7–11 below describe the state before the cleanup. `app/api/[...path]/AGENTS.md` describes the current semantics.

**Step 0: characterization cases added to `app/api/[...path]/route.test.ts`, green against the old `route.ts` before anything moves.** Each pins a semantic the route table must reproduce.

Routing and ordering:

1. Unknown route without a session → 401 (the actor is resolved before the 404).
2. POST to an unknown route from a foreign origin → 403.
3. `POST /api/health` from a foreign origin → 403 (`sameOrigin` runs before public routes).
4. `GET /api/actions` → 404 and `GET /api/approvals/:id/confirm` → 404. For GET and POST, a route the method does not match falls through to 404, never 405. Other verbs are Next's concern, since only GET and POST are exported.
5. Operator posting an invalid `/api/actions` body → 400 (body parsed before the role check).
6. `POST /api/conversations/:id/messages` on another customer's conversation with an invalid body → 404 (ownership checked before the body).

Method-agnostic routes and trailing segments: 7. `POST /api/health` (same origin) → health payload. 8. `POST /api/incidents` as an operator → incident list (an authenticated route that accepts any method). 9. `POST /api/conversations/:id` → conversation detail. 10. `GET /api/conversations/:id/messages` → conversation detail. 11. Trailing segments are accepted on `conversations/:id/messages/x`, `approvals/:id/confirm/x` and `documents/:id/chunks/x`, with today's response for each.

Roles and side effects: 12. Operator → 403 on both `GET` and `POST /api/conversations`. 13. The conversation title is updated from the first message even when `sendMessage` fails (fake OpenAI returns 500). 14. The `Set-Cookie` response also carries `Cache-Control: no-store`.

**Created, test-first:**

- `src/http/router.ts` + `router.test.ts`: `:param`, trailing `*rest`, `GET | POST | ANY`, first match wins, no match → `null`.
- `src/http/errors.ts` + `errors.test.ts`: today's mapping exactly. The optional `requestId` parameter is accepted but unused.
- `src/http/respond.ts` + `respond.test.ts`: `no-store` merged with extra headers.

**Created without sibling tests:** `src/http/handle.ts`, `routes.ts` and `handlers/*.ts`. They are covered by `route.test.ts` through `api()` (the HTTP integration suite, which is not split; `TESTING.md` "Current map" says so). Each handler owns its zod body schema and its role check, in today's order.

**`route.ts` after the phase:** only the literal exports `runtime`, `dynamic`, `GET` and `POST`. `public-surface.test.ts` asserts `GET` and `POST`.

**Acceptance:**

- `route.ts` ≤ 20 lines.
- No `appDb`, `zod` or `as any` in `route.ts` or `handle.ts`.
- The existing `route.test.ts` cases are byte-identical, and all step-0 cases are green.
- `npm run build` passes, and the test-preservation gate is green.

**Unlocks:** P2-7, P0-5, P1-6, P1-7 (`handle.ts`), P0-3, P2-8 (`handlers/dashboard.ts`), P1-8 (`handlers/health.ts`), P1-9 (`handlers/actions.ts`).
**Rollback:** `git revert`. Phase 1 stays valid.

### Phase 3 — Banking: bank port + intent lifecycle (3 h)

**Step 0: characterization case added to `src/banking/actions.test.ts`, green on the old code.** A `processing` intent with a `bank_reference`, re-proposed with the same `intentId` and no approval, ends `requires_confirmation` with a new live approval. The title is neutral: "should create a proposal when a processing intent is proposed again with the same intent id".

**Created, test-first:**

- `src/banking/bank.ts` + `bank.test.ts` (real bank). It exports:
  - `accounts(userId)`
  - `contacts(userId)`
  - `movements(userId)`
  - `transfer(userId, input, reference)`
  - `operation(userId, reference)`, which keeps `encodeURIComponent`
  - `operatorCustomer(operatorId, customerId)`

  Paths, methods and bodies are identical to today's.

- `src/banking/intents.ts` + `intents.test.ts`. The `TRANSITIONS` table holds the **observed** edges, documentation only:

| from                                                                  | to                               | today's writer                                           |
| --------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| (insert)                                                              | `created`                        | `actions.ts` INSERT OR IGNORE                            |
| `created`, `requires_confirmation`, `failed`, `unknown`, `processing` | `requires_confirmation`          | `authorization.ts` (re-proposal with the same intent id) |
| `requires_confirmation`                                               | `processing`                     | `actions.ts` after the approval is consumed              |
| `processing`                                                          | `completed`, `unknown`, `failed` | `actions.ts`                                             |
| `unknown`, `failed`                                                   | `completed`                      | `reconcile.ts`                                           |
| `unknown`                                                             | `failed`                         | `reconcile.ts` (bank 404)                                |

`transition(id, to, fields)` runs `UPDATE intents SET status=?, … WHERE id=?`, unconditional as today, and returns `{ changed, legal }`. `legal` is computed from `TRANSITIONS` and is a return value only: no event, no log, no throw.

Tests (titles neutral; none of them declares a disputed edge correct, per `TESTING.md:89-90, 240`):

- "should write the status even when the edge is outside the table"
- "should report legal=false for completed→processing"
- "should report legal=true for requires_confirmation→processing"
- "should write fields atomically with the status"
- "should report changed=false for an unknown intent id"
- "should record no event when it writes a transition", which asserts that `events()` is unchanged

**Edited:**

- `actions.ts`, `authorization.ts`, `dispatch.ts` and `reconcile.ts` call `transition()`. `dispatch.ts` sets `bank_reference` through the intents repo as a field write.
- `operator/view.ts`, the tool code (`list_accounts`, `operation_status`) and `handlers/dashboard.ts` go through `bank.ts`.

**Untouched characterization:** `actions`, `authorization`, `dispatch`, `reconcile`, `client`, `operator/view` and `route` tests.

**Acceptance:**

- `UPDATE intents` appears only in `src/persistence/intents.ts`.
- `bankRequest(` appears only in `client.ts`, `bank.ts` and tests.
- The lossy-bank cases still give `unknown` → `completed`.
- The test-preservation gate is green.

**Unlocks:** P0-1, P0-2, P0-3, P0-4, P1-9, P2-12. Enforcing `legal` comes later, with TDD, in the P0 block (open question 5).
**Rollback:** `git revert`. No schema change.
**Then the go/no-go checkpoint:** report to the user.

### Phase 4 — Agent: model gateway, tool registry, loop split (4 h)

**Created, test-first:**

- `src/model/gateway.ts` + `gateway.test.ts`:
  - `openai()` is still built per call, with `maxRetries: 2` and `timeout: 45000`.
  - Also exports `MissingOpenAIKeyError` and pass-through `createResponse` / `createEmbeddings`.
  - The `describe('openai')` block moves here from `retrieval/embeddings.test.ts`, with its hooks.
  - New case: request and embeddings round-trips against the fake OpenAI.
  - `retrieval/embeddings.ts` re-exports `openai` and `MissingOpenAIKeyError`.
- `src/agent/tools/strict-schema.ts` + test:
  - emits key order `type, properties, required, additionalProperties`;
  - emits `required: []` for an empty object;
  - throws on an optional field;
  - ignores refinements;
  - strips `minLength`, `maxLength`, `maximum` and `exclusiveMinimum`.
- `src/agent/tools/registry.ts` + `registry.test.ts`:
  - The `describe('toolDefinitions')` cases move here.
  - **Golden case:** `JSON.stringify(toolDefinitions) === JSON.stringify(<today's array, pasted as a literal before the switch>)`.
  - Unknown tool → `{status:'failed', error:'Unknown tool.'}` plus a `tool.failed` event.
- One file per tool, each exporting `{ name, description, input, execute }`. `execute` keeps today's parsing exactly:
  - `list_accounts` does not parse its arguments;
  - `request_human` checks `conversationId` before parsing;
  - `transfer_money` passes raw arguments to `transferMoney`.

  `input` is used only to derive the definition. Each tool's `runTool` describe cases move into `tools/<name>.test.ts` with their hooks.

- `src/agent/loop.ts` + `loop.test.ts` (fake OpenAI and real bank):
  - stops on a text turn;
  - returns `finished: false` after the round limit;
  - turns invalid JSON arguments into a failed output plus a `tool.failed` event;
  - uses intent id `${runId}:${call_id}`;
  - sends **`JSON.stringify(fake.requests[0].body.tools)` equal to the same golden string**.
- `src/agent/conversation.ts` and `src/agent/evidence.ts`. `run.test.ts` → `conversation.test.ts` (`describe('sendMessage')`) and `evidence.test.ts` (`describe('answerWithEvidence')`), verbatim with hooks.

**Shims:**

- `src/agent/run.ts` re-exports `sendMessage` and `answerWithEvidence`.
- `src/agent/tools.ts` re-exports `toolDefinitions` and `runTool`. `tools.test.ts` is emptied into the new files and deleted; the gate proves nothing was lost.
- `public-surface.test.ts` asserts all shim exports.

**Acceptance:**

- `new OpenAI`, `.responses.create` and `.embeddings.create` appear only in `src/model/gateway.ts`.
- No `appDb` or `.prepare` in `loop.ts`.
- The golden test and the loop wire test are green.
- `npm run doctor` runs once afterwards as a real-API smoke test. It costs quota, so Pablo runs it.
- The test-preservation gate is green.

**Unlocks:** P1-1, P1-2, P1-3, P1-4, P1-7 (usage per round), P2-9, P2-10, P2-11, and Part 2 tools as one file each (open question 3).
**Rollback:** `git revert`.

### Phase 5 — UI split (3 h), serially after phase 4 in the main tree

Phase 5 does not run in parallel. The e2e stack uses fixed ports 3100/4101/4102, `reuseExistingServer: false`, `rm -rf .e2e/data`, and shared `TESTING.md` / `AGENTS.md`.

**Step 0: new journeys in `app/page.e2e.ts`, green against today's `page.tsx`.** They use `workers: 1` and the shared bank, and leave the existing exact-count journeys green (17 cases, 9 open, 68/80 documents). The new journeys only read, or create data that those counts do not include (conversations, a rejected transfer).

1. A customer searches the documents and opens one in the reader.
2. A customer starts a new conversation, and it appears in the conversation list.
3. **Generation guard:** `page.route('**/api/dashboard', …)` delays **only the first (customer)** dashboard request, via a counter in the handler, so it lands after the operator's. Meanwhile the persona switches to an operator. The test asserts that no customer account or movement data renders in the operator workspace once the delayed response lands. **One-time discrimination check:** temporarily delete the guard at `page.tsx:112` (`if (g !== generation.current) return;`), confirm the journey fails, restore the line, and record the result in the commit message.
4. **A transfer the bank rejects shows the bank's reason in the notice, and the notice can be dismissed:** a manual transfer for more than the balance (from `tests/fixtures/world.ts` money) gets confirmed; the bank answers 422, `actions.ts` returns 200 `{status:'failed'}`, and the UI shows it through `setNotice`. Assert `getByRole('status')` contains the error text, then click "Dismiss notice". (Today's behaviour; P1-9 calls the 200 defensible, so this does not pin a known-wrong behaviour. A double-confirm 409 is not used: it would need a race and be flaky.)

**Edited:**

- `app/page.tsx`: the inline async handlers at about lines 766 (open case), 867 (update index), 889 (search submit) and 944 (open document) are lifted into named `Home` handlers, keeping their `generation` checks. `page.tsx` then holds only state, effects, handlers and composition.
- `app/_ui/*`: presentational components (props in, callbacks out).
- `app/_ui/format.ts` + `format.test.ts`.
- `app/_ui/api.ts`.
- Class names, text and DOM order stay unchanged, and `globals.css` is untouched.

**Acceptance:**

- `page.tsx` ≤ 450 lines and holds only state, effects, handlers and composition; no panel exceeds 200 lines.
- `npm run build` passes.
- All 11 e2e journeys are green.
- The test-preservation gate is green.

**Unlocks:** P0-6 (`ApprovalsPanel.tsx`), the P0-3 UI, the P0-4 notice.
**Rollback:** `git revert`.

---

## 4. Ordering

```
P1 ──► P2 ──► P3 ──► [go/no-go checkpoint] ──► P4 ──► P5      (strictly serial, main tree)
```

- **P1 before everything:** every later phase uses the repos.
- **P2 before P3:** P3 edits `handlers/dashboard.ts`.
- **P3 before P4:** the tool modules use the bank port.
- **P4 before P5:** the shared e2e ports and data dir, plus shared docs.

Parallelism exists only inside a phase, for independent sub-steps such as individual repos or tool files. One executor integrates them before the commit.

---

## 5. Risks and mitigations

| Risk                                                           | Mitigation                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route semantics drift                                          | 14 step-0 cases; `ANY` and `*rest` in the router; the table's order mirrors the if-chain; existing `route.test.ts` cases byte-identical                      |
| Next 16 route-file rules                                       | Only literal `runtime`/`dynamic`/`GET`/`POST` exports in `route.ts`; `npm run build` (which validates route exports) in phase 2; keep `await context.params` |
| Breaking a frozen import (simulator, scripts, graders' checks) | Section 2 table; shims; `public-surface.test.ts`                                                                                                             |
| `z.toJSONSchema` ≠ strict wire                                 | Normalizer + string-equal golden test + loop wire test                                                                                                       |
| Validation drift in tools                                      | `execute` keeps today's parse calls                                                                                                                          |
| Migrations on existing `.data` and concurrent opens            | Verbatim DDL; `.immediate()` transaction re-reading `user_version`; two-connection test; back up `.data` first                                               |
| Config mutation by the harness                                 | Mutable `config`, same keys; destructuring grep                                                                                                              |
| Response-shape drift                                           | `SELECT *` rows where a row reaches a client                                                                                                                 |
| Lifecycle change hidden in a refactor                          | Unconditional writes; `legal` is informational, with no events; the new processing re-proposal characterization case                                         |
| UI split breaks untested interactions                          | 4 step-0 journeys, including a forced generation-guard race; markup preserved; `npm run build`                                                               |
| Overrun before Monday                                          | Estimates per phase; 1.5× stop rule; checkpoint after phase 3                                                                                                |

### Pre-mortem

1. **The UI gets a 404 or 405 on a path it used.** Step-0 cases 4, 7-11 and the e2e journeys catch it.
2. **OpenAI rejects the tool schema in production only** (the fake does not validate). The string-equal golden test plus the loop wire test guarantee identical `tools`, and `npm run doctor` gives a real-API smoke test.
3. **A transfer re-proposed while its dispatch is in flight changes outcome after phase 3.** This concurrent race (`processing → requires_confirmation` written during `dispatchTransfer`) is **not** caught by the existing tests. A sequential characterization case exists, but no test reproduces the interleaving.
   - Mitigation: `transition()` writes unconditionally, exactly as today, so phase 3 cannot change that race's outcome.
   - The race itself is fixed later, with TDD, in the P0 block (open question 5).

---

## 6. Readiness findings → landing module

| Finding                              | Lands in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 unreadable bank body            | `src/banking/client.ts`; harness mode in `tests/support/network.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P0-2 stuck `processing`              | `src/banking/reconcile.ts` + `TRANSITIONS` row (and enforcement if chosen) in `banking/intents.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P0-3 customer-side reconcile         | `src/http/handlers/dashboard.ts` + `reconcile.ts` (`reconcileOpenIntents`) + `persistence/intents.ts`; UI `app/_ui/ApprovalsPanel.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P0-4 retry creates a new intent      | `src/banking/authorization.ts` + `persistence/intents.ts`; UI `app/_ui/TransferForm.tsx`; agent text `tools/transfer-money.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P0-5 DNS rebinding                   | `src/auth.ts` (`trustedHost`), first call in `src/http/handle.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P0-6 readable proposal card          | `app/_ui/ApprovalsPanel.tsx` + confirm busy state in `Home`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P1-1 duplicate proposals             | `src/banking/authorization.ts` + `persistence/approvals.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P1-2 retrieval failure               | `src/agent/conversation.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P1-3 transfer outcomes across turns  | new `src/agent/tools/recent-transfers.ts` + `reconcile.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P1-4 run deadline                    | `src/model/gateway.ts` (`signal`, `maxRetries`) + `agent/conversation.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P1-5 default secrets                 | `assertProductionSecrets(config, nodeEnv)` (pure, tested in `config.test.ts`), called once at boot from a new root `instrumentation.ts` `register()`, guarded by `process.env.NEXT_RUNTIME === 'nodejs'` (Next 16 `instrumentation.md`: called once per server instance; root location, since `app/` is not under `src/`). `loadConfig` never throws. `Secure` cookie in `handlers/session.ts`. Note: `next start` runs in production mode and `scripts/setup.ts` copies the 21-char defaults from `.env.example`, so when P1-5 lands `setup` must generate random secrets of 32+ characters (or the check exempts the documented dev defaults on localhost); decided with TDD in the P0/P1 block, not in this refactor. Moving `adminSecret` out of the app config is **out of scope**: `simulator/{server,db}.ts` read `config`, so `production-readiness.md:183` ("move adminSecret out") is infeasible without changing the simulator |
| P1-6 rate/cost limits                | new `src/http/rate-limit.ts` used in `handle.ts`; history budget in `conversation.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P1-7 observability                   | `handle.ts` + `errors.ts`; migration 2 (`runs.finished_at`, usage); `model.round` event in `loop.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P1-8 readiness health                | `handlers/health.ts` + `bank.ts` (`health()`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P1-9 `/api/actions` 200 on rejection | `src/http/handlers/actions.ts` (status mapping from the tool result) + `created → rejected` row in `TRANSITIONS` + `banking/actions.ts` (mark `rejected`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P1-10 Next advisories, headers       | `package.json`, `next.config.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P2-1 in-memory lock                  | `agent/conversation.ts` + `persistence/conversations.ts` + migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P2-2 / P2-4 / P2-7                   | done in phases 1 / 1 / 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P2-3 indexes, retention              | migration in `src/migrations.ts`; redaction in `src/telemetry.ts` / `persistence/events.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P2-5 retrieval cost                  | `src/retrieval/store.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P2-6 embedding cache of user text    | `src/retrieval/embeddings.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P2-8 all-or-nothing dashboard        | `handlers/dashboard.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P2-9 raw internal errors             | `agent/conversation.ts` + `tools/registry.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P2-10 tool output size               | `tools/registry.ts` + `ingestion/pipeline.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P2-11 tool argument limits           | `tools/operation-status.ts`, `transferSchema`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P2-12 operator reconcile as customer | `operator/view.ts` + `bank.operatorCustomer`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P2-13 session expiry                 | `src/auth.ts` + `handlers/session.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

---

## 7. ADR

- **Decision.** Five strictly serial phases with a go/no-go checkpoint after phase 3:
  1. config + migrations + repos for shared tables;
  2. a route table behind the catch-all;
  3. a bank port + an observed-transitions table with an unconditional `transition()`;
  4. a model gateway + a zod-derived tool registry + the loop/conversation split;
  5. a presentational UI split.

  All are behaviour-preserving, with a frozen public import surface and a reporter-based test-preservation gate.

- **Drivers.** Characterization stays valid; wire compatibility; one landing module per finding within the Monday budget (~18 h).
- **Alternatives considered:**
  - Next file-based route handlers: rejected for the 405/404 change and the harness rewrite.
  - Repos for every table, with `src/db/` replacing `src/db.ts`: rejected because it breaks a frozen path and adds repos with no finding behind them.
  - Hand-written or raw tool schemas: rejected for two sources of truth, or a changed wire.
  - Conditional (enforcing) transitions now: rejected because it would change behaviour in an untested race.
  - One function per transition: rejected because the lifecycle could not be reviewed in one place.
  - Frozen config: rejected for harness churn.
  - `agent/model.ts`: rejected for the inverted dependency.
  - UI hooks or a `(ui)` route group: rejected for the generation-guard risk and because route groups are meant for routing.
  - Moving `route.test.ts` blocks to handler tests: dropped. The suite stays the HTTP integration suite, which kills a whole class of move errors.
  - Parallel phase 5: dropped because of the fixed e2e ports and shared data dir.
- **Why chosen.** It is the smallest set of seams that makes each P0/P1 fix local while every existing test keeps working as an oracle and every external import keeps working.
- **Consequences:**
  - About 30 new files and a hand-rolled router to maintain.
  - Shims in `agent/run.ts`, `agent/tools.ts` and `retrieval/embeddings.ts`.
  - SQL lives in `persistence/` plus the retrieval modules.
  - `config` stays mutable.
  - `transition()` records `legal` but does not enforce it yet.
  - Handlers have no sibling tests; `route.test.ts` covers them, and `TESTING.md` says so.
- **Follow-ups:**
  - Update `submission/architecture-decoupling.md` to this plan.
  - In the P0 block, decide enforcement for `transition()` (open question 5), with TDD.
  - Route-quirk cleanup (open question 4).
  - The Part 2 tool as a registry entry (open question 3).
  - Optionally record this decision in the hub (Pablo's choice).

---

## 8. User decisions (2026-10-10)

1. **Sequencing: option (c).** Phases 1–3 (~11 h), then the P0 money-path block (P0-1..P0-4, ~4-5 h, TDD), then phases 4–5 (~7 h). Total ~22-23 h. The P0 fixes are safe before Monday even if phases 4/5 slip.
2. **Go/no-go checkpoint after phase 3: approved.** Report time spent vs 11 h before starting the P0 block.
3. **Part 2 tool as first registry entry in phase 4:** still open; depends on the Part 2 feature choice.
4. **Route quirks: clean them up in a separate commit after phase 2**, test-first (explicit 404/405), as a visible, isolated behaviour change.
5. **`transition()` after the P0 block: reject illegal transitions** (no write, error), introduced with a failing test first.

Resolved since revision 1:

- Moving `route.test.ts` blocks into handler tests is dropped.
- Phase 5 runs serially after phase 4.

## 9. Phase 6 — screaming folders (2026-10-10)

A pure move/rename refactor: no behaviour change, no logic edits, only import paths, re-export shims, new `index.ts` files, the ESLint boundary rules and docs. Every move used `git mv`.

- **Tree.** `src/` now has one folder per feature, each owning its logic, repos (`*.repo.ts`), agent tools (`tools/*.tool.ts`) and HTTP handlers (`http/`):
  - `transfers/`: was `banking/{actions→transfer-money,authorization,dispatch,reconcile,intents→intent-lifecycle}`, `persistence/{intents,approvals}` (now `*.repo.ts`), the `transfer_money`/`operation_status` tools and `handlers/{actions,approvals}`.
  - `accounts/`: `http/dashboard.ts` (was `http/handlers/dashboard.ts`) and the `list_accounts` tool.
  - `assistant/`: `loop`, `conversation`, `evidence`, `prompt` (was `agent/`), `tool-registry.ts`, `strict-schema.ts` (was `agent/tools/`), `runs.repo.ts`, `http/preview-answer.ts`.
  - `conversations/`: the two repos, `ownership.ts` (`conversationFor`) and `http/conversations.ts`.
  - `knowledge/`: `search/` (was `retrieval/`), `ingestion/`, the `search_documents` tool and the `search`/`documents`/`ingestion` handlers.
  - `support/`: `operator-view.ts` (was `operator/view.ts`), `incidents.repo.ts`, the `request_human` tool, `http/incidents.ts`.
  - `identity/`: `auth.ts`, `people.ts`, `http/{people,session}.ts`.
  - `platform/`: `config.ts`, `crypto.ts` (`sign`, `equal`, from `auth.ts`), `db/{db,migrations,statement}`, `bank/{client,bank}` (was `banking/`), `model/gateway`, `http/{router,context,respond,errors,http-error,health}` (`HttpError` from `auth.ts`), `telemetry/{telemetry,events.repo}`.
  - `server/`: the composition root, `routes.ts` (was `http/routes.ts`), `handle.ts` (was `http/handle.ts`) and `seed.ts` (was `src/seed.ts`).
  - `app/_ui/` is grouped the same way plus `shell/` and `lib/`.
- **Dependency rules** (`eslint.config.mjs`, each proven to fire on a planted violation):
  - Features depend on `platform/`; a feature imports another only through its `index.ts` (static or `import()`).
  - `platform/` imports no feature and not `server/`; there are no exceptions. The shared primitives a feature also exports (`sign`/`equal`, `HttpError`) moved into `platform/` and `identity` re-exports them, so all importers get the same class (checked at runtime through `src/auth`, `identity` and `platform`).
  - Only `server/` deep-imports a feature's `http/`; features import `server/` only from tests (`seedApp`); `app/`, `scripts/` and `tests/` never import a feature's `http/`.
  - Nothing in `src/` imports a frozen shim or the `@/src/` alias.
  - A tool imports only types from `assistant` (`@typescript-eslint/no-restricted-imports`, `allowTypeImports`).
- **No runtime import cycles.** `conversationFor` moved from `conversations/http/` to `conversations/ownership.ts`, so `conversations/index.ts` no longer loads `assistant`, the tool registry or the model gateway. Tools take `Tool` as a type only. A value-import graph of `src/` has no cycle.
- **Frozen surface.** Every path in `public-surface.test.ts` still exists: the moved modules are re-exported by thin shims (`config`, `db`, `seed`, `auth`, `people`, `banking/{client,actions}`, `ingestion/pipeline`, `retrieval/{store,embeddings}`; `agent/{run,tools}` were already shims and now re-export straight from the assistant modules). Nothing in the app imports a shim; `scripts/`, `tests/` and the route import the new paths. Feature `index.ts` files export only what another feature or `server/` uses.
- **Gates.** Lint 0 errors (the same 5 warnings), format, typecheck, `npm test` 441, the test-title preservation diff empty, Playwright 11, `next build`.

## 10. Phase 7 — Hexagonal verticals with use cases and entry-point DI (plan, 2026-10-10)

**Status: plan, approved design, critic review applied (§10.11); 7a done (shared kernel, `DomainError` mapping, error-text characterization pins, layer-rule scaffold with fire-proofs); 7b done (transfers as a hexagonal vertical: domain, ports, services, use cases, adapters, `wireTransfers`/`transfers()`, frozen `legacy.ts`; dashboard and operator view call its use cases; `POST actions` moved to `assistant/http/run-action.ts`); 7c done (assistant as a hexagonal vertical: `domain/{prompt,run-policy}`, ports, `run-agent-loop` service, `send-message`/`run-tool`/`preview-answer` use cases, OpenAI model adapter, `wireAssistant`/`assistant()` with per-graph conversation locks pinned by bypass-failing tests, frozen `legacy.ts`; `POST conversations/:id/messages` moved to `assistant/entry-points/http/post-message.ts`, the last `eslint-disable` in `src/` deleted; `toolDefinitions` derived in `dependencies.ts` since entry-points may not import infrastructure); 7d not started.** A behaviour-preserving refactor in four sub-phases (7a, 7b, 7c, and 7d as five commits), on top of the Phase 6 tree. **All of Phase 7 lands before Part 2.** The design below was fixed by the user; this section grounds it in the code at `1832523` and resolves the places where the code and the design disagree (§10.10).

### 10.1 Rationale

Phase 6 made the tree scream the business, but each feature still mixes four things in one flat folder: transport (`http/`, `tools/`), business rules (`heldBy`, the 5xx rule, staleness, `TRANSITIONS`), I/O (`statement()`, `bank.*`, `createResponse`) and process state (`dispatching`, `locks`). As a result, the rules can only be tested through SQLite and the bank, `HttpError` leaks into business code, and the Part 2 feature has no obvious seam. Phase 7 splits every vertical into entry-points → application → domain, with infrastructure behind ports. The verticals are wired by hand in one `dependencies.ts` per vertical, so:

- each business rule becomes a pure, unit-tested function;
- each business operation becomes one use case that both the HTTP handler and the agent tool call;
- every I/O dependency is a port, so a test can swap only the clock and ids and keep the real bank and SQLite.

#### Folder contract

```
src/
├── shared/                   kernel; imports nothing outside shared/ (zod allowed in domain/)
│   ├── domain/               errors.ts (DomainError + kinds), bank-failure.ts (BankFailure), reference-date.ts
│   └── ports/                clock.ts (Clock), ids.ts (Ids), unit-of-work.ts (UnitOfWork) — types only
├── platform/                 unchanged role; may import shared/; adds runtime.ts (systemClock, randomIds)
├── <vertical>/               transfers | accounts | assistant | conversations | knowledge | support | identity
│   ├── entry-points/
│   │   ├── http/             request → parse → command → use case → json()   (Handler / PublicHandler)
│   │   ├── tools/            args → command → use case → tool result          (Tool objects, golden-identical)
│   │   ├── dependencies.ts   wireX(overrides) builds the graph; x() is the lazy per-process singleton (internals hidden)
│   │   └── legacy.ts         frozen-signature functions the src/ shims re-export (only where a shim exists)
│   ├── application/
│   │   ├── use-cases/        one operation per file: export type X; export const makeX = (deps) => (cmd) => result
│   │   ├── services/         steps shared by use cases of this vertical (authorize-transfer, dispatch-transfer…)
│   │   └── ports/            interfaces this vertical needs (repos, bank, model, registries, other verticals)
│   ├── domain/               pure: entities/types, policies, state machine, messages; throws DomainError only
│   ├── infrastructure/       implements ports over platform/ (sqlite repos, http bank adapter, OpenAI adapter, in-memory registries)
│   ├── index.ts              re-exports entry-points only: handlers, tools, the x() accessor, legacy functions, `export type` of Tool
│   └── AGENTS.md
└── server/                   routes.ts (handlers from each vertical's index), handle.ts, seed.ts — no wiring
```

Light verticals have no empty folders. `identity` and `accounts` have no `domain/` and no `services/`. `conversations` and `support` have a `domain/` but no `services/`.

#### Request flow

```
HTTP ─► app/api/[...path]/route.ts ─► server/handle.ts ─ sameOrigin ─ actor ─ routes.ts (handler from <v>/index.ts)
                                                                                │
        ┌───────────────────────────────────────────────────────────────────────┘
        ▼
  <v>/entry-points/http/h.ts        <v>/entry-points/tools/t.tool.ts   (called by assistant RunTool)
   role gate (HttpError) ─ zod       args ─ (tool-local checks)
        │ command (actor, ids, intentId, runId, conversationId, overridePendingIntentId…)
        ▼
  x().useCase(cmd) ─────────────── x() = lazy singleton from <v>/entry-points/dependencies.ts
        │
        ▼
  application/use-cases ─► services ─► domain (pure rules, DomainError)
        │ ports
        ▼
  infrastructure (sqlite repos, bank adapter: BankError → BankFailure, OpenAI adapter, registries) ─► platform/
        │
  errors ◄── DomainError ─► platform/http/errors.ts: toErrorResponse (status + {error: message}), same as today
             tool path   ─► RunTool: {status:'failed', error: e.message}, byte-identical text
```

#### Vertical rank (acyclic by construction)

| Rank | Vertical                                 | May value-import (through index.ts only, from entry-points only) |
| ---: | ---------------------------------------- | ---------------------------------------------------------------- |
|    0 | `identity`, `knowledge`, `conversations` | none                                                             |
|    1 | `transfers`                              | any lower rank (uses `identity`)                                 |
|    2 | `support`                                | any lower rank (uses `transfers`, `conversations`, `identity`)   |
|    3 | `accounts`                               | any lower rank (uses `transfers`, `support`)                     |
|    4 | `assistant`                              | any lower rank (uses every other vertical)                       |

`import type` of a higher rank is allowed because TypeScript erases it. The only such import is the `Tool` type that each tool takes from `assistant`. Two of today's edges break this order, and both handlers move to `assistant` with unchanged URLs (§10.10, C1):

- `transfers/http/actions.ts` imports `assistant.runTool`, but transfers has rank 1;
- `conversations/http/conversations.ts:postMessage` imports `assistant.sendMessage`, but conversations has rank 0.

The move is recorded in `src/transfers/AGENTS.md` and `src/conversations/AGENTS.md` ("`POST /api/actions` and `POST /api/conversations/:id/messages` are served by `assistant/entry-points/http/`; the URLs did not change") in the commit that moves each handler (7b and 7c).

### 10.2 Use-case catalog (33)

C = command (writes), Q = query, Q\* = query that settles unverified intents with the bank first (today's behaviour, kept).

The public routes are `GET health`, `GET people` and `POST session`; `routes.ts` has 16 more private routes. Two routes have no use case:

- `GET health` stays `platform/http/health.ts`;
- `GET session` only echoes the resolved actor from `identity/entry-points/http/session.ts`.

**transfers (8)**

| Use case                   | C/Q | Callers                                                                                                   | Ports                                                                                                                                                                   | Replaces                                                                                            |
| -------------------------- | --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `TransferMoney`            | C   | tool `transfer_money`; `ConfirmProposal`; `legacy.transferMoney` (shim `banking/actions`)                 | `IntentRepository`, `ApprovalRepository`, `TransfersBank`, `DispatchRegistry`, `CustomerDirectory`, `EventLog`, `UnitOfWork`, `Clock`, `Ids`, `settings` (via services) | `transfers/transfer-money.ts:transferMoney`, `:record`, `:storedOutcome`                            |
| `FindProposal`             | Q   | `POST approvals/:id/confirm` (step 1, before the body is read)                                            | `ApprovalRepository`, `IntentRepository`                                                                                                                                | `transfers/http/approvals.ts:confirmApproval` lines 12–15                                           |
| `ConfirmProposal`          | C   | `POST approvals/:id/confirm` (step 3, after the body)                                                     | `TransferMoney` (injected use case), `Ids`                                                                                                                              | `transfers/http/approvals.ts:confirmApproval` lines 18–29                                           |
| `GetOperationStatus`       | Q   | tool `operation_status`                                                                                   | `TransfersBank`                                                                                                                                                         | `transfers/tools/operation-status.tool.ts:execute`                                                  |
| `ReconcileIntent`          | C   | `TransferMoney`; service `authorize-transfer` (twins); `ListPendingTransfers`; `GetConversationTransfers` | `IntentRepository`, `TransfersBank`, `DispatchRegistry`, `Clock`, `settings`; service `transition-intent`                                                               | `transfers/reconcile.ts:reconcileIntent`, `:stale`, `:unverified`, `:settle`                        |
| `ListPendingTransfers`     | Q\* | `accounts.GetCustomerOverview` through `PendingTransfersQuery`                                            | `IntentRepository`, `ReconcileIntent`, `Clock`                                                                                                                          | `accounts/http/dashboard.ts:pendingTransfers`; default of `intents.repo.ts:pendingIntentsOf`        |
| `ListLiveProposals`        | Q   | `accounts.GetCustomerOverview` through `PendingTransfersQuery`                                            | `ApprovalRepository`, `Clock`                                                                                                                                           | `accounts/http/dashboard.ts` lines 35–38                                                            |
| `GetConversationTransfers` | Q\* | `support.GetCaseDetail` through `ConversationTransfers`                                                   | `IntentRepository`, `ReconcileIntent`                                                                                                                                   | `support/operator-view.ts` lines 23–28 (sequential reconcile, then `intentsIn` with parsed payload) |

Services (not use cases):

- `authorize-transfer`: `authorization.ts:authorizeTransfer`, `:reconcileTwins`.
- `dispatch-transfer`: `dispatch.ts:dispatchTransfer`, `:intentReference`.
- `transition-intent`: `intent-lifecycle.ts:transition`.
- `record-outcome`: `transfer-money.ts:record`, which reads the row through the repo and delegates to `domain/outcome.ts:storedOutcome`.

**accounts (2)**

| Use case              | C/Q | Callers                                      | Ports                                   | Replaces                                                                                                     |
| --------------------- | --- | -------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ListAccounts`        | Q   | tool `list_accounts`                         | `AccountsBank`                          | `accounts/tools/list-accounts.tool.ts:execute` (two sequential calls, accounts then contacts: order kept)    |
| `GetCustomerOverview` | Q\* | `GET dashboard` when the actor is a customer | `AccountsBank`, `PendingTransfersQuery` | `accounts/http/dashboard.ts:dashboard` customer branch (`Promise.all` of 4, then live proposals: order kept) |

**support (4)**

| Use case               | C/Q | Callers                                       | Ports                                                                                                         | Replaces                                                                                |
| ---------------------- | --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ListIncidents`        | Q   | `GET incidents`                               | `IncidentRepository`                                                                                          | `support/http/incidents.ts:listIncidents` (after the role gate)                         |
| `GetOperatorWorkspace` | Q   | `GET dashboard` when the actor is an operator | `IncidentRepository`                                                                                          | `accounts/http/dashboard.ts:dashboard` line 28 (`{ incidents }`)                        |
| `GetCaseDetail`        | Q\* | `GET incidents/:id`                           | `People`, `IncidentRepository`, `ConversationHistory`, `EventReader`, `ConversationTransfers`, `OperatorBank` | `support/operator-view.ts:caseDetail`                                                   |
| `RequestHuman`         | C   | tool `request_human`                          | `IncidentRepository`, `Ids`, `Clock`                                                                          | `support/tools/request-human.tool.ts:execute` lines 13–24 (after the tool-local checks) |

**conversations (7)**

| Use case                | C/Q | Callers                                                                                                          | Ports                                         | Replaces                                                             |
| ----------------------- | --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `StartConversation`     | C   | `POST conversations`                                                                                             | `ConversationRepository`, `Ids`, `Clock`      | `conversations/http/conversations.ts:createConversation` lines 16–23 |
| `ListConversations`     | Q   | `GET conversations`                                                                                              | `ConversationRepository`                      | `:listConversations`                                                 |
| `GetConversationDetail` | Q   | `GET conversations/:id`                                                                                          | `ConversationRepository`, `MessageRepository` | `:conversationDetail`                                                |
| `GetOwnedConversation`  | Q   | `POST conversations/:id/messages` (step 1); `POST actions` (ownership); `assistant.ConversationLog.requireOwned` | `ConversationRepository`                      | `conversations/ownership.ts:conversationFor`                         |
| `TitleConversation`     | C   | `POST conversations/:id/messages` (step 3, before `SendMessage`)                                                 | `ConversationRepository`                      | `conversations/http/conversations.ts:postMessage` lines 33–34        |
| `AppendMessage`         | C   | `assistant.SendMessage` through `ConversationLog.append`                                                         | `MessageRepository`                           | the three `insertMessage` calls in `assistant/conversation.ts`       |
| `ListMessages`          | Q   | `assistant.SendMessage` (history); `support.GetCaseDetail` (history)                                             | `MessageRepository`                           | `conversations/messages.repo.ts:messagesIn` as used across features  |

**knowledge (5)**

| Use case            | C/Q | Callers                                                                                                  | Ports                                                   | Replaces                                                  |
| ------------------- | --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `SearchDocuments`   | Q   | `POST search` (actor role); tool `search_documents` (role `customer`); `assistant.KnowledgePort`         | `ChunkStore`, `Embedder`, `settings`                    | `knowledge/search/search.ts:searchDocuments`              |
| `ListDocuments`     | Q   | `GET documents`                                                                                          | `DocumentCatalog`, `ChunkStore`                         | `knowledge/http/documents.ts:listDocuments`, `:visibleTo` |
| `GetDocument`       | Q   | `GET documents/:id`                                                                                      | `DocumentCatalog`                                       | `:documentDetail`, `:visibleDocument`                     |
| `GetDocumentChunks` | Q   | `GET documents/:id/chunks`                                                                               | `DocumentCatalog`, `ChunkStore`                         | `:documentChunks`                                         |
| `IngestDocuments`   | C   | `POST ingestion` (after the role gate); `legacy.ingest` (shim `ingestion/pipeline`, `scripts/ingest.ts`) | `DocumentCatalog`, `Embedder`, `ChunkStore`, `settings` | `knowledge/ingestion/pipeline.ts:ingest`                  |

**assistant (3)**

| Use case        | C/Q | Callers                                                                                     | Ports                                                                                                              | Replaces                                   |
| --------------- | --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `SendMessage`   | C   | `POST conversations/:id/messages` (step 4); `legacy.sendMessage` (shim `agent/run`)         | `ConversationLog`, `ConversationLocks`, `RunRepository`, `KnowledgePort`, `Clock`, `Ids`; service `run-agent-loop` | `assistant/conversation.ts:sendMessage`    |
| `RunTool`       | C   | `POST actions`; service `run-agent-loop`; `legacy.runTool` (shim `agent/tools`)             | `ToolCatalog`, `EventLog`, `Clock`                                                                                 | `assistant/tool-registry.ts:runTool`       |
| `PreviewAnswer` | Q   | `POST preview-answer` (after the role gate); `legacy.answerWithEvidence` (shim `agent/run`) | `ModelPort`                                                                                                        | `assistant/evidence.ts:answerWithEvidence` |

Service `run-agent-loop` replaces `assistant/loop.ts:runLoop`; its dependencies are `ModelPort`, `RunTool`, `ToolCatalog` and `EventLog`. `wireAssistant()` returns it only as `internals.runAgentLoop`, for the moved `loop.test.ts`.

**identity (4)**

| Use case        | C/Q | Callers                                                            | Ports                              | Replaces                                                                                                                   |
| --------------- | --- | ------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `VerifySession` | Q   | `server/handle.ts` through the `actor` guard (every private route) | `SessionTokens`, `PeopleDirectory` | `identity/auth.ts:actor` lines 18–21: `({ token }) => Person \| undefined` (the guard keeps the cookie read and both 401s) |
| `ListPeople`    | Q   | `GET people`                                                       | `PeopleDirectory`                  | `identity/http/people.ts:listPeople`                                                                                       |
| `StartSession`  | C   | `POST session` (after the body)                                    | `PeopleDirectory`, `SessionTokens` | `identity/http/session.ts:selectPerson` lines 9–12                                                                         |
| `FindPerson`    | Q   | `transfers.CustomerDirectory`; `support.People`; `legacy.person`   | `PeopleDirectory`                  | `identity/people.ts:person` as used by other features                                                                      |

**Command shape.** A use case takes one object. Per-request data always travels in that object: `userId`/actor, `conversationId`, `runId`, `intentId`, `approvalId`, `overridePendingIntentId`, plus the payload. It is never injected.

**`FindProposal` / `ConfirmProposal` shapes.** `FindProposal({ userId, approvalId })` returns `{ approval: { id, payload }, intent: { id, conversationId } }`, or throws `NotFoundError('Proposal not found.')` / `NotFoundError('Intent not found.')` in that order. The entry-point then reads and parses the body exactly as today. `ConfirmProposal({ userId, approvalId: approval.id, intentId: intent.id, conversationId: intent.conversationId, payload: approval.payload, overridePendingIntentId })` takes `runId` from `Ids.uuid()` and calls `TransferMoney({ userId, conversationId, runId, intentId, approvalId, overridePendingIntentId, args: JSON.parse(payload) })`. That reproduces `approvals.ts:18-29` field for field.

`TransferMoney` is the one exception to "parse in the entry-point": its command carries the raw `args: unknown` (`TransferMoneyCommand = ToolContext & { args: unknown }`). Today the customer check (403) runs before the schema parse, and an operator sending invalid arguments sees the 403. The use case therefore calls `domain/transfer.ts:parseTransfer` itself, after the check (§10.10, C4).

### 10.3 Port catalog (31)

The ports of each vertical live in `<v>/application/ports/<port>.ts`. Each adapter lives in `<v>/infrastructure/` unless the table says "wired". A wired port is satisfied in `dependencies.ts` by another vertical's `x()` accessor, called lazily inside the arrow, never at wiring time. Row and record types (`IntentRow`, `NewIntent`, `IntentFields`, `ApprovalRow`, `NewApproval`, …) move to `<v>/domain/*.ts` with the same names. `tests/fixtures/factories.ts` and `tests/support/db.ts` update their type imports.

**shared (3)**

```ts
// src/shared/ports/clock.ts — adapter: platform/runtime.ts systemClock = { now: () => new Date() }
export type Clock = { now(): Date };
// src/shared/ports/ids.ts — adapter: platform/runtime.ts randomIds = { uuid: () => randomUUID() }
export type Ids = { uuid(): string };
// src/shared/ports/unit-of-work.ts — adapter: transfers/infrastructure/sqlite-unit-of-work.ts over platform/db/statement.ts:atomically
export type UnitOfWork = { atomically<T>(step: () => T): T };
```

**transfers (6)**

```ts
export type IntentRepository = {
  insertIfAbsent(i: NewIntent): number; // insertIntentIfAbsent
  byId(id: string): IntentRow | undefined; // intentById
  ownedBy(id: string, userId: string): IntentRow | undefined; // intentOf
  inConversation(conversationId: string): IntentRow[]; // intentsIn
  unsettledIdsIn(conversationId: string): { id: string }[]; // unsettledIntentIds
  pendingOf(userId: string, limit: number, failedSince: string): IntentRow[]; // pendingIntentsOf (no default: the use case passes failedSince(clock.now()))
  pendingTwinsOf(userId: string, payload: string, excludeId: string): IntentRow[];
  update(id: string, fields: IntentFields): number; // updateIntent
  compareAndSet(
    id: string,
    to: IntentStatus,
    from: readonly IntentStatus[],
    fields?: Omit<IntentFields, 'status'>,
  ): number; // transitionIntent
};
export type ApprovalRepository = {
  insert(a: NewApproval): void;
  consume(a: {
    id: string;
    userId: string;
    intentId: string;
    payload: string;
    now: string;
  }): number;
  liveFor(
    intentId: string,
    userId: string,
    now: string,
  ): Pick<ApprovalRow, 'id' | 'payload' | 'expires_at'> | undefined;
  liveOf(userId: string, now: string): ApprovalRow[];
  ownedBy(id: string, userId: string): ApprovalRow | undefined; // approvalOf
};
/** Every method rejects with BankFailure, never BankError. */
export type TransfersBank = {
  accounts(userId: string): Promise<Account[]>;
  contacts(userId: string): Promise<{ id: string }[]>;
  transfer(userId: string, input: TransferInput, reference: string): Promise<Operation>;
  operation(userId: string, reference: string): Promise<Operation>;
};
export type DispatchRegistry = {
  add(intentId: string): void;
  delete(intentId: string): void;
  has(intentId: string): boolean;
};
export type CustomerDirectory = { roleOf(userId: string): Person['role'] | undefined };
export type EventLog = {
  record(ctx: ToolContext, kind: string, data: Record<string, unknown>): void;
};
```

| Port                 | Adapter                                                                                                                 | From                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `IntentRepository`   | `infrastructure/sqlite-intents.repo.ts` (`sqliteIntents`)                                                               | `transfers/intents.repo.ts` (functions kept, plus the adapter object; `insertIntent` stays an exported function for `server/seed.ts`) |
| `ApprovalRepository` | `infrastructure/sqlite-approvals.repo.ts` (`sqliteApprovals`)                                                           | `transfers/approvals.repo.ts`                                                                                                         |
| `TransfersBank`      | `infrastructure/http-transfers-bank.adapter.ts`                                                                         | wraps `platform/bank/bank.ts`; `catch (e) { throw e instanceof BankError ? bankFailureFrom(e) : e }`                                  |
| `DispatchRegistry`   | `infrastructure/in-memory-dispatch-registry.ts` (`inMemoryDispatchRegistry()` returns a new `Set` wrapper)              | `transfers/dispatch.ts` line 17 (`dispatching`), `:isDispatching`                                                                     |
| `CustomerDirectory`  | wired: `{ roleOf: (id) => identity().findPerson({ id })?.role }` (until 7d: `person(id)?.role` from the identity index) | `transfer-money.ts` line 67                                                                                                           |
| `EventLog`           | `infrastructure/telemetry-event-log.ts`                                                                                 | `platform/telemetry/telemetry.ts:recordEvent`                                                                                         |

`settings` is declared structurally in `transfers/application/ports/settings.ts` as `export type TransfersSettings = { readonly bankTimeoutMs: number }`, because application code cannot import `platform/config`. The value injected is the mutable `config` object itself, read at call time, as `staleProcessingMs(deps.settings.bankTimeoutMs)`.

**accounts (2)**

```ts
export type AccountsBank = {
  // rejects with BankFailure
  accounts(userId: string): Promise<Account[]>;
  contacts(userId: string): Promise<Contact[]>; // Contact/Movement redeclared structurally in the port file
  movements(userId: string): Promise<Movement[]>;
};
export type PendingTransfersQuery = {
  pendingTransfers(userId: string): Promise<PendingTransfer[]>; // { id, status, payload, createdAt, operationId? }
  liveProposals(userId: string): LiveProposal[]; // approval rows with payload parsed
};
```

| Port                    | Adapter                                                                                            | From                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `AccountsBank`          | `infrastructure/http-accounts-bank.adapter.ts`                                                     | `platform/bank/bank.ts` accounts/contacts/movements |
| `PendingTransfersQuery` | wired: `transfers().listPendingTransfers({ userId })`, `transfers().listLiveProposals({ userId })` | `accounts/http/dashboard.ts`                        |

**assistant (7)**

```ts
// application may `import type` from 'openai' (erased); value imports of 'openai' stay in infrastructure.
export type ModelPort = {
  /** Body built verbatim from loop.ts:18-28 (key order kept); chatModel read at call time. */
  agentTurn(req: {
    instructions: string;
    input: ResponseInputItem[];
    tools: FunctionTool[];
  }): Promise<{ items: ResponseInputItem[]; calls: ResponseFunctionToolCall[]; text: string }>;
  /** Body built verbatim from evidence.ts:6-13. */
  evidenceAnswer(req: {
    instructions: string;
    question: string;
  }): Promise<{ answer: string; model: string; usage: ResponseUsage | undefined }>;
};
export type Tool = {
  name: string;
  description: string;
  input: z.ZodObject;
  execute(args: unknown, ctx: ToolContext): Promise<unknown>;
};
export type ToolCatalog = { definitions: FunctionTool[]; find(name: string): Tool | undefined };
export type KnowledgePort = { search(query: string): Promise<SearchResult[]> };
export type ConversationLog = {
  requireOwned(conversationId: string, userId: string): void; // throws NotFoundError('Conversation not found.')
  append(m: NewMessage): void; // id and createdAt come from SendMessage, as today
  history(conversationId: string): { role: string; content: string }[];
};
export type RunRepository = {
  insert(r: NewRun): void;
  setStatus(id: string, status: string, error?: string): void;
};
export type ConversationLocks = {
  tryAcquire(conversationId: string): boolean;
  release(conversationId: string): void;
};
export type EventLog = {
  record(ctx: ToolContext, kind: string, data: Record<string, unknown>): void;
};
```

| Port                | Adapter                                                                                                                                                                                    | From                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `ModelPort`         | `infrastructure/openai-model.adapter.ts` over `platform/model/gateway.ts:createResponse` + `toResponseInputItems`; provider errors pass through untouched (`SendMessage` reads `e.status`) | `assistant/loop.ts` lines 18–30, `assistant/evidence.ts` |
| `ToolCatalog`       | `infrastructure/static-tool-catalog.ts` (`staticToolCatalog(tools)`, uses `infrastructure/strict-schema.ts`)                                                                               | `assistant/tool-registry.ts` lines 20–33                 |
| `KnowledgePort`     | wired: `knowledge().searchDocuments({ query, role: 'customer' })` (until 7d: `searchDocuments` from the knowledge index)                                                                   | `assistant/conversation.ts` line 27                      |
| `ConversationLog`   | wired: `conversations().getOwnedConversation`, `.appendMessage`, `.listMessages` (until 7d: `conversationOf`/`insertMessage`/`messagesIn` from the conversations index)                    | `assistant/conversation.ts` lines 11, 18, 28, 40, 65     |
| `RunRepository`     | `infrastructure/sqlite-runs.repo.ts`                                                                                                                                                       | `assistant/runs.repo.ts`                                 |
| `ConversationLocks` | `infrastructure/in-memory-conversation-locks.ts`                                                                                                                                           | `assistant/conversation.ts` line 9 (`locks`)             |
| `EventLog`          | `infrastructure/telemetry-event-log.ts`                                                                                                                                                    | `platform/telemetry/telemetry.ts:recordEvent`            |

The tool list stays a static module, `assistant/entry-points/tools/catalog.ts`. It holds `export const tools = [listAccountsTool, searchDocumentsTool, transferMoneyTool, operationStatusTool, requestHumanTool]` in today's order, taken from the vertical indexes, and `export const toolDefinitions = staticToolCatalog(tools).definitions`. It is computed at module load, as today, so `legacy.toolDefinitions` is a plain value.

**conversations (2)**

```ts
export type ConversationRepository = {
  insert(c: NewConversation): void;
  ownedBy(id: string, userId: string): ConversationRow | undefined; // conversationOf
  ofUser(userId: string): ConversationRow[]; // conversationsOf
  rename(id: string, title: string): void;
};
export type MessageRepository = {
  insert(m: NewMessage): void;
  in(conversationId: string): MessageRow[];
};
```

The adapters are `infrastructure/sqlite-conversations.repo.ts` and `infrastructure/sqlite-messages.repo.ts`, moved from the two `*.repo.ts` files. The functions are kept, and `insertConversation` and `insertMessage` stay exported for `server/seed.ts`.

**knowledge (3)**

```ts
export type ChunkStore = {
  all(): Chunk[];
  indexModel(): string | undefined;
  count(): { chunks: number };
  replace(chunks: Chunk[], settings: { model: string; dimensions: number }): void;
};
export type Embedder = { embed(texts: string[]): Promise<number[][]> };
export type DocumentCatalog = { list(): DocumentRecord[]; read(doc: DocumentRecord): string };
```

| Port              | Adapter                                                                                                                                                                        | From                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `ChunkStore`      | `infrastructure/sqlite-chunk-store.ts` (also keeps `exportIndex`, `restoreIndex` as exported functions for seed and shims)                                                     | `knowledge/search/store.ts`       |
| `Embedder`        | `infrastructure/cached-openai-embedder.ts` (keeps `dimensions`, `vectorBuffer`, `readVector`, `embeddingKey`, `embedTexts` and the `openai`/`MissingOpenAIKeyError` re-export) | `knowledge/search/embeddings.ts`  |
| `DocumentCatalog` | `infrastructure/fixture-document-catalog.ts` (`documents`, `readDocument`) + `infrastructure/index-snapshot.ts` (`saveInitialIndex`)                                           | `knowledge/ingestion/pipeline.ts` |

`settings` is declared structurally in `knowledge/application/ports/settings.ts` as `export type KnowledgeSettings = { readonly embeddingModel: string }`. The value injected is the mutable `config` object. The index model check and the result of `IngestDocuments` read it at call time. `dimensions` (1536) moves to `knowledge/domain/retrieval.ts` as `EMBEDDING_DIMENSIONS`, and the embedder file re-exports it as `dimensions`.

**support (6)**

```ts
export type IncidentRepository = {
  insert(i: NewIncident): void;
  all(): IncidentRow[];
  byId(id: string): IncidentRow | undefined;
  openIn(conversationId: string): { id: string } | undefined;
};
export type EventReader = { inConversation(conversationId: string): EventRow[] };
export type ConversationHistory = { messagesIn(conversationId: string): MessageRow[] };
export type ConversationTransfers = {
  reconcileAndList(userId: string, conversationId: string): Promise<IntentView[]>;
};
export type OperatorBank = {
  customer(operatorId: string, customerId: string): Promise<{ operations: BankOperation[] }>;
};
export type People = { find(id: string): Person | undefined };
```

| Port                    | Adapter                                                                                                    | From                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `IncidentRepository`    | `infrastructure/sqlite-incidents.repo.ts` (`insertIncident` stays exported for seed)                       | `support/incidents.repo.ts`             |
| `EventReader`           | `infrastructure/telemetry-event-reader.ts` over `platform/telemetry/events.repo.ts:eventsIn`               | `support/operator-view.ts` line 19      |
| `ConversationHistory`   | wired: `conversations().listMessages({ conversationId })`                                                  | `support/operator-view.ts` line 18      |
| `ConversationTransfers` | wired: `transfers().getConversationTransfers({ userId, conversationId })`                                  | `support/operator-view.ts` lines 23–28  |
| `OperatorBank`          | `infrastructure/http-operator-bank.adapter.ts` over `platform/bank/bank.ts:operatorCustomer` (BankFailure) | `support/operator-view.ts` line 33      |
| `People`                | wired: `identity().findPerson`                                                                             | `support/operator-view.ts` lines 15, 41 |

**identity (2)**

```ts
export type PeopleDirectory = { all(): Person[]; find(id: string): Person | undefined };
export type SessionTokens = {
  issue(userId: string): string;
  /** The user id when the token's signature is valid, otherwise undefined. */
  verify(token: string): string | undefined;
};
```

The adapters are `infrastructure/people-roster.ts` (`people`, `person`, moved from `identity/people.ts`) and `infrastructure/hmac-session-tokens.ts`. The second implements `issue` (today's `sessionToken`) and `verify` (today's split-and-compare in `actor`, `identity/auth.ts` lines 18–21) over `platform/crypto` and `config.sessionSecret`. `actor` keeps the two 401 messages and calls the `VerifySession` use case (§10.2). `sign` and `equal` are not identity behaviour: the `src/auth.ts` shim re-exports them directly from `platform/crypto` (and `HttpError` from `platform/http/http-error`), not through `identity/entry-points/legacy.ts`.

**dependencies.ts template (every vertical follows it):**

```ts
// src/transfers/entry-points/dependencies.ts
export type TransfersDeps = {
  intents: IntentRepository;
  approvals: ApprovalRepository;
  bank: TransfersBank;
  dispatching: DispatchRegistry;
  customers: CustomerDirectory;
  events: EventLog;
  unitOfWork: UnitOfWork;
  clock: Clock;
  ids: Ids;
  settings: TransfersSettings;
};
/** Only the clock and ids may be faked. Registries, repos and the bank are always the real ones. */
export type TransfersOverrides = Partial<Pick<TransfersDeps, 'clock' | 'ids'>>;
const defaults = (): TransfersDeps => ({
  intents: sqliteIntents,
  approvals: sqliteApprovals,
  bank: httpTransfersBank,
  dispatching: inMemoryDispatchRegistry(),
  customers: { roleOf: (id) => identity().findPerson({ id })?.role },
  events: telemetryEventLog,
  unitOfWork: sqliteUnitOfWork,
  clock: systemClock,
  ids: randomIds,
  settings: config,
});
export function wireTransfers(overrides: TransfersOverrides = {}) {
  const deps = { ...defaults(), ...overrides };
  const transition = makeTransitionIntent(deps);
  const reconcileIntent = makeReconcileIntent({ ...deps, transition });
  const authorizeTransfer = makeAuthorizeTransfer({ ...deps, transition, reconcileIntent });
  const dispatchTransfer = makeDispatchTransfer(deps);
  const transferMoney = makeTransferMoney({
    ...deps,
    transition,
    reconcileIntent,
    authorizeTransfer,
    dispatchTransfer,
  });
  return {
    transferMoney,
    findProposal: makeFindProposal(deps),
    confirmProposal: makeConfirmProposal({ ...deps, transferMoney }),
    getOperationStatus: makeGetOperationStatus(deps),
    reconcileIntent,
    listPendingTransfers: makeListPendingTransfers({ ...deps, reconcileIntent }),
    listLiveProposals: makeListLiveProposals(deps),
    getConversationTransfers: makeGetConversationTransfers({ ...deps, reconcileIntent }),
    /** Tests only: the services, wired to the same deps. */
    internals: { transition, authorizeTransfer, dispatchTransfer, dispatching: deps.dispatching },
  };
}
/** What index.ts exposes: the use cases, never the internals. */
export type TransfersApp = Omit<ReturnType<typeof wireTransfers>, 'internals'>;
let graph: TransfersApp | undefined;
export const transfers = (): TransfersApp => (graph ??= wireTransfers());
```

`internals` exists only for the moved service tests (`transition-intent.test.ts`, `authorize-transfer.test.ts`, `dispatch-transfer.test.ts`, and the reconcile "dispatch in flight" cases that mark `internals.dispatching`). `wireAssistant` does the same with `internals: { runAgentLoop }` for `run-agent-loop.test.ts` (today's `loop.test.ts`). The accessors exported from `index.ts` are typed `TransfersApp` / `AssistantApp`, so production code cannot reach `internals`. Acceptance grep: `grep -rln "internals" src | grep -v "\.test\.ts$"` lists only the two `dependencies.ts` files.

### 10.4 Domain extraction list (TDD: each test below is written first, seen red because the module or function does not exist yet, then made green by moving the code)

| New pure function (file)                                                                                                                                                                                                                                                                 | Extracted from                                                                                           | Tests to write first (`describe` = function)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bankFailureKind(status)` (`shared/domain/bank-failure.ts`)                                                                                                                                                                                                                              | the `e.status >= 500` / `=== 404` checks in `dispatch.ts:32`, `transfer-money.ts:108`, `reconcile.ts:40` | should classify 500, 502 and 504 as unreachable · should classify 404 as not found · should classify 400, 403, 409 and 422 as rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `TRANSITIONS`, `IntentStatus`, `IllegalTransitionError` (moved verbatim), `predecessorsOf(to)` (`transfers/domain/transitions.ts`)                                                                                                                                                       | `intent-lifecycle.ts:18-36`, `:49-51`                                                                    | should list created, requires_confirmation, unknown and failed as predecessors of requires_confirmation · should list only requires_confirmation as the predecessor of processing · should list processing, unknown and failed as predecessors of completed · should list no predecessor for created · should keep completed terminal                                                                                                                                                                                                                                                                                                                                                                          |
| `transferSchema` (moved), `parseTransfer(args)`, `payloadOf(input)`, `assertSameIntent(previous, userId, payload)`, `assertOwnsSource(accounts, input)`, `assertKnownDestination(accounts, contacts, input)` (`transfers/domain/transfer.ts`)                                            | `transfer-money.ts:13-24`, `:69`, `:72-74`; `authorization.ts:43-49`                                     | should reject a transfer to the same account · should serialise the payload in schema key order whatever the argument order · should reject an intent id reused by another customer as a conflict · should reject an intent id reused with another payload as a conflict · should accept the same customer and payload · should reject a source account the customer does not own as forbidden · should accept a contact as destination · should reject an unknown destination as a bad request                                                                                                                                                                                                                |
| `heldBy(twins, intentId, overridePendingIntentId)`, `HELD_MESSAGE` (`transfers/domain/holds.ts`)                                                                                                                                                                                         | `authorization.ts:22-31` (the repo read stays in the service and passes `twins`)                         | should hold nothing without a pending twin · should hold by the newest twin with the exact review message · should release the hold when the override names the newest twin · should keep the hold when the override names an older twin                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `APPROVAL_TTL_MS`, `approvalExpiresAt(now)` (`transfers/domain/approval.ts`)                                                                                                                                                                                                             | `authorization.ts:10`, `:87`                                                                             | should expire a proposal ten minutes after it is made                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DISPATCH_ATTEMPTS`, `shouldRetryDispatch(error, attempt)`, `dispatchOutcome(error)`, `storedOutcome(row, input)`, `UNCONFIRMED_MESSAGE`, `CHANGED_STATE_MESSAGE` (`transfers/domain/outcome.ts`)                                                                                        | `dispatch.ts:15`, `:32`; `transfer-money.ts:107-114` (the 5xx rule), `:26-46`                            | should treat an unreachable bank as an unknown outcome with the unconfirmed message · should treat a bank rejection as failed with the bank's message · should treat a bank not-found as failed · should treat any other error as failed with its message · should fall back to "Transfer error" for a non-Error throw · should retry only an unreachable failure before the last attempt · should answer a completed row as a replayed completed operation · should answer any other stored status with the changed-state message                                                                                                                                                                             |
| `staleProcessingMs(bankTimeoutMs)`, `isStale(intent, nowMs, staleMs)`, `isUnverified(…)`, `shouldReconcile(intent, dispatching, nowMs, staleMs)`, `reconcileDecision(intent, lookup, nowMs, staleMs)` (`transfers/domain/reconciliation.ts`)                                             | `reconcile.ts:12`, `:17-23`, `:34`, `:36-45`                                                             | should allow twice the longest dispatch before a processing intent is stale · should measure staleness from dispatched_at · should fall back to created_at on older rows · should consider unknown and failed unverified at any age · should consider a fresh processing intent still owned by its dispatch · should skip an intent without a bank reference · should skip an intent whose dispatch is in flight · should complete an intent the bank found · should fail a stale unknown intent the bank has no operation for · should leave a fresh intent the bank has no operation for · should leave a failed intent the bank has no operation for · should leave the intent when the bank is unreachable |
| `PENDING_TRANSFERS_LIMIT`, `failedSince(now)`, `toPendingTransfer(intent)` (`transfers/domain/pending-transfer.ts`)                                                                                                                                                                      | `dashboard.ts:7`, `:16-25`; `intents.repo.ts:86`                                                         | should look back 24 hours for failed transfers · should show the operation id only when the bank booked one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `MAX_ROUNDS` (re-exported as `maxRounds`), `FALLBACK_ANSWER`, `INVALID_TOOL_ARGUMENTS`, `toolIntentId(runId, callId)`, `historyWindow(messages)`, `runOutcome(finished)`, `failureText(e)`, `failureReply(error)` (`assistant/domain/run-policy.ts`)                                     | `loop.ts:7`, `:15`, `:42`, `:50-51`; `conversation.ts:29-31`, `:48-55`, `:58-63`, `:69`                  | should key each tool call's intent by run and call id · should keep only the last 24 messages · should complete a finished run · should mark a run that hit the round limit incomplete with the round-limit message · should name the provider status when the provider failed · should use the error message otherwise · should fall back to the generic text for a non-Error throw · should prefix the failure reply                                                                                                                                                                                                                                                                                         |
| `knowledgeInstructions` (moved), `agentInstructions(sources)` (`assistant/domain/prompt.ts`; `referenceDate` from `shared/domain/reference-date.ts`)                                                                                                                                     | `prompt.ts`; `conversation.ts:32-34`                                                                     | should append the tool rules to the knowledge instructions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `canSee(role, audience)`, `inForceOn(chunk, referenceDate)`, `rankChunks(chunks, queryVector, limit)`, `assertIndexMatches(indexModel, embeddingModel)`, `visibleDocuments(role, docs)`, `findVisibleDocument(role, docs, id)`, `EMBEDDING_DIMENSIONS` (`knowledge/domain/retrieval.ts`) | `search.ts:10-33`; `documents.ts:8-14`                                                                   | should let operators see internal documents · should keep only public ones for customers · should keep chunks in force on the reference date · should rank by dot product and cut to the limit · should reject incompatible dimensions · should report a missing index · should report a model mismatch · should report an invisible document as not found                                                                                                                                                                                                                                                                                                                                                     |
| `chunkDocument` (moved; `knowledge/domain/chunker.ts`)                                                                                                                                                                                                                                   | `knowledge/ingestion/chunker.ts`                                                                         | existing `chunker.test.ts` moves with it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `NEW_CONVERSATION_TITLE`, `titleFor(conversation, content)`, `requireOwned(row)` (`conversations/domain/conversation.ts`)                                                                                                                                                                | `conversations.ts:33-34`; `ownership.ts:4-7`                                                             | should title an untitled conversation from the first 50 characters · should keep an existing title · should report a conversation the user does not own as not found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `caseGaps({ hasEvents, bankReachable })`, `operationsFor(operations, intents)` (`support/domain/case-evidence.ts`)                                                                                                                                                                       | `operator-view.ts:29-38`, `:47`                                                                          | should report no gap when evidence is complete · should name missing agent activity · should name an unreachable bank · should join both gaps with one space · should keep only operations whose reference an intent holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Error messages stay byte-identical. Each message moves as a named constant next to the rule that throws it, and every test above asserts the exact text.

### 10.5 Error model

```ts
// src/shared/domain/errors.ts — no `status` field: statuses live in platform/http (see the note on SendMessage below)
export abstract class DomainError extends Error {
  abstract readonly kind:
    'not_found' | 'conflict' | 'forbidden' | 'bad_request' | 'unavailable' | 'bank';
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class NotFoundError extends DomainError {
  readonly kind = 'not_found';
}
export class ConflictError extends DomainError {
  readonly kind = 'conflict';
}
export class ForbiddenError extends DomainError {
  readonly kind = 'forbidden';
}
export class BadRequestError extends DomainError {
  readonly kind = 'bad_request';
}
export class UnavailableError extends DomainError {
  readonly kind = 'unavailable';
}
// src/shared/domain/bank-failure.ts — keeps the bank's status and message, as BankError did
export class BankFailure extends DomainError {
  readonly kind = 'bank';
  constructor(
    readonly reason: 'unreachable' | 'rejected' | 'notFound',
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const bankFailureFrom = (e: { status: number; message: string }) =>
  new BankFailure(bankFailureKind(e.status), e.status, e.message);
```

`platform/http/errors.ts` gains three things:

- `httpStatusOf(e)` maps not_found → 404, conflict → 409, forbidden → 403, bad_request → 400, unavailable → 502 and bank → `e.status`. It returns `e.status` for `HttpError`/`BankError` and `undefined` otherwise.
- `toErrorResponse` gets one new branch after the `HttpError`/`BankError` branch: `if (e instanceof DomainError) return json({ error: e.message }, httpStatusOf(e)!)`.
- `toLegacyError(e)` maps a `BankFailure` to `new BankError(status, message)` and any other `DomainError` to `new HttpError(httpStatusOf(e)!, e.message)`. It returns every other value unchanged (same reference).

Only `legacy.ts` functions use `toLegacyError`, so frozen-surface callers still catch the classes they catch today.

Three rules keep the error paths behaving as today:

- **Plain `Error`s stay plain `Error`s**: their HTTP answer is today's generic 500. This covers the 13 sites `tool-registry.ts:40`, `strict-schema.ts:32,38`, `config.ts:41`, `search.ts:12,14,27`, `request-human.tool.ts:11`, `embeddings.ts:43,50`, `store.ts:19,86` and `pipeline.ts:15`. `IllegalTransitionError` stays `extends Error`, because an escaped one is a 500 today.
- **`MissingOpenAIKeyError` and provider errors pass through every adapter untouched.**
- **`SendMessage` and `status`:** `SendMessage` treats any caught error that has a `status` as a provider failure (`conversation.ts:58-60`). `DomainError` therefore has no `status`. Only `BankFailure` has one, exactly as `BankError` had, and no bank call happens inside that `try` (tools catch their own errors).

**Every `new HttpError(` site (26, `grep -rn "new HttpError(" src`):**

| #   | Site (today)                             | Status · message                                                            | Phase 7 owner                                                       | Becomes                       | Pinned by                                                                                                                                                                                                             |
| --- | ---------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `identity/auth.ts:17`                    | 401 · Select a person to continue.                                          | `identity/entry-points/http/session-guard.ts:actor`                 | stays `HttpError` (transport) | **7a new** route case: `GET /api/session` without a cookie                                                                                                                                                            |
| 2   | `identity/auth.ts:21`                    | 401 · Invalid session.                                                      | same                                                                | stays `HttpError`             | `route.test.ts`                                                                                                                                                                                                       |
| 3   | `identity/auth.ts:31`                    | 403 · Origin not allowed.                                                   | `session-guard.ts:sameOrigin`                                       | stays `HttpError`             | `route.test.ts`, `errors.test.ts`                                                                                                                                                                                     |
| 4   | `identity/auth.ts:39`                    | 403 · Origin not allowed.                                                   | same                                                                | stays `HttpError`             | `route.test.ts`                                                                                                                                                                                                       |
| 5   | `server/handle.ts:30`                    | 404 · Route not found.                                                      | `server/handle.ts`                                                  | stays `HttpError`             | `route.test.ts`                                                                                                                                                                                                       |
| 6   | `transfers/http/actions.ts:24`           | 403 · A customer is required.                                               | `assistant/entry-points/http/run-action.ts` (role gate before body) | stays `HttpError`             | `route.test.ts`                                                                                                                                                                                                       |
| 7   | `assistant/http/preview-answer.ts:26`    | 403 · Operator role required.                                               | `assistant/entry-points/http/preview-answer.ts` (gate before body)  | stays `HttpError`             | `route.test.ts` (**7a**: assert the message on this route)                                                                                                                                                            |
| 8   | `knowledge/http/ingestion.ts:6`          | 403 · Operator role required.                                               | `knowledge/entry-points/http/ingestion.ts`                          | stays `HttpError`             | **7a new** route case if absent                                                                                                                                                                                       |
| 9   | `support/http/incidents.ts:7`            | 403 · Operator role required.                                               | `support/entry-points/http/incidents.ts` (both handlers)            | stays `HttpError`             | **7a new** route case for `GET incidents/:id` if absent                                                                                                                                                               |
| 10  | `conversations/http/conversations.ts:12` | 403 · Select a customer to open a chat.                                     | `conversations/entry-points/http/conversations.ts`                  | stays `HttpError`             | `route.test.ts`                                                                                                                                                                                                       |
| 11  | `identity/http/session.ts:9`             | 400 · Unknown person.                                                       | `identity` `StartSession`                                           | `BadRequestError`             | `route.test.ts`                                                                                                                                                                                                       |
| 12  | `conversations/ownership.ts:6`           | 404 · Conversation not found.                                               | `conversations/domain/conversation.ts:requireOwned`                 | `NotFoundError`               | `route.test.ts`                                                                                                                                                                                                       |
| 13  | `assistant/conversation.ts:11`           | 404 · Conversation not found.                                               | `SendMessage` via `ConversationLog.requireOwned` (same rule as #12) | `NotFoundError`               | `conversation.test.ts` (status) + **7a**: assert message                                                                                                                                                              |
| 14  | `assistant/conversation.ts:13`           | 409 · Wait for the previous response to finish.                             | `SendMessage`                                                       | `ConflictError`               | `conversation.test.ts` (status) + **7a**: assert message                                                                                                                                                              |
| 15  | `assistant/conversation.ts:73`           | 502 · The AI provider returned N. Check permissions and quota. / error text | `SendMessage`                                                       | `UnavailableError`            | `conversation.test.ts` (status) + **7a new** route case (fake 429 → 502 + message)                                                                                                                                    |
| 16  | `support/operator-view.ts:15`            | 403 · Operator role required.                                               | `GetCaseDetail`                                                     | `ForbiddenError`              | `operator-view.test.ts` + **7a**: assert message                                                                                                                                                                      |
| 17  | `support/operator-view.ts:17`            | 404 · Case not found.                                                       | `GetCaseDetail`                                                     | `NotFoundError`               | **7a new** route case: `GET incidents/unknown` as operator                                                                                                                                                            |
| 18  | `transfers/http/approvals.ts:13`         | 404 · Proposal not found.                                                   | `FindProposal`                                                      | `NotFoundError`               | `route.test.ts`                                                                                                                                                                                                       |
| 19  | `transfers/http/approvals.ts:15`         | 404 · Intent not found.                                                     | `FindProposal`                                                      | `NotFoundError`               | **7a new** route case (approval row without its intent, via `approvalFactory`)                                                                                                                                        |
| 20  | `knowledge/http/documents.ts:12`         | 404 · Document not found.                                                   | `knowledge/domain/retrieval.ts:findVisibleDocument`                 | `NotFoundError`               | **7a new** route cases: `GET documents/unknown` and a customer opening an internal document (detail + chunks)                                                                                                         |
| 21  | `transfers/transfer-money.ts:68`         | 403 · A customer account is required.                                       | `TransferMoney`                                                     | `ForbiddenError`              | `transfer-money.test.ts` (status) + **7a new** tool-text case (`runTool` with an operator ctx)                                                                                                                        |
| 22  | `transfers/transfer-money.ts:74`         | 409 · This intent belongs to a different payload.                           | `domain/transfer.ts:assertSameIntent`                               | `ConflictError`               | `transfer-money.test.ts`                                                                                                                                                                                              |
| 23  | `transfers/transfer-money.ts:79`         | 409 · This transfer is already being sent.                                  | `TransferMoney`                                                     | `ConflictError`               | `transfer-money.test.ts`                                                                                                                                                                                              |
| 24  | `transfers/authorization.ts:44`          | 403 · This account does not belong to this person.                          | `domain/transfer.ts:assertOwnsSource`                               | `ForbiddenError`              | `authorization.test.ts` (status) + **7a new** tool-text case via `POST actions`                                                                                                                                       |
| 25  | `transfers/authorization.ts:48`          | 400 · The destination account does not exist.                               | `domain/transfer.ts:assertKnownDestination`                         | `BadRequestError`             | **7a new** tool-text case via `POST actions` (`unknown.account`)                                                                                                                                                      |
| 26  | `transfers/authorization.ts:73`          | 409 · This proposal has expired or was already used.                        | service `authorize-transfer`                                        | `ConflictError`               | `authorization.test.ts` (status) + **7a new** route case (expired proposal → 409 + message: the same throw site, `authorization.ts:72-73`; a second confirm does not reach it today, it replays the completed result) |

Of the 26 `HttpError` sites, 16 (#11–#26) become a `DomainError` and 10 (#1–#10) are transport sites that stay `HttpError` in entry-points or `server/`. Role gates stay in the entry-points because every one of them runs **before** the body parse (`route.test.ts` pins that order). A use case cannot reproduce that order without receiving an unparsed body. The four `BankError` sites (`platform/bank/client.ts:35,43,48` and `transfers/dispatch.ts:36`) behave as follows:

- The three client sites are unchanged; `platform/` does not move.
- Only `transfers/dispatch.ts:36` changes: the dispatch fallback becomes `new BankFailure('unreachable', 504, 'The operation could not be completed.')`.
- Each bank adapter translates at the boundary.

**Tool error text.** `RunTool` keeps `e instanceof Error ? e.message : 'Tool error'` verbatim. Every `DomainError` and `BankFailure` carries the same `message` as the error it replaces, and `ZodError` is never wrapped, so the text the model and `POST /api/actions` receive is unchanged. 7a pins it before anything moves (§10.6).

### 10.6 Sub-phases

#### Common gates (every sub-phase, before its commit)

0. Before starting, record the sub-phase's own base: `BASE=$(git rev-parse HEAD)`.
1. Before starting, refresh the preservation baseline with the §3 command into `.omc/state/tests-before.txt`. Afterwards, `comm -23 tests-before.txt tests-after.txt` must be empty.
2. Run `npm run lint`: 0 errors, and no more than today's 5 warnings.
3. Run `npm run format:check` and `npm run typecheck`.
4. Run `npm test`: at least 441 plus this sub-phase's new tests, all passing.
5. `npx playwright test` (`npm run test:e2e`): 11 pass. `NEXT_DIST_DIR=.next-e2e npm run build` passes.
6. `git diff --exit-code "$BASE" -- tests/fixtures/tool-definitions.ts src/public-surface.test.ts` reports no change, so the golden definitions and the frozen surface stay byte-identical within the sub-phase. Diffing against the sub-phase's own base, not `1832523`, keeps the gate valid if Part 2 later changes the golden list in its own commit (it lands after all of Phase 7).
7. `src/import-graph.test.ts` (added in 7a) is green.
8. The config grep is extended: `grep -rnE "const \{[^}]+\} = (config|settings|deps\.settings)" src app` finds nothing.
9. **ESLint fire-proofs** for every rule the sub-phase adds or tightens:
   - plant the probe file listed, run `npx eslint <probe>`, see the expected message, then delete the probe;
   - paste the probe/message table into the commit message.
10. Update `TESTING.md` "Current map" and the `AGENTS.md` of every touched folder in the same commit.

**Moved tests.** These rules apply to every test file a sub-phase moves:

- Leaf titles and assertion values are verbatim.
- The only body edits allowed are:
  - import paths;
  - adapting a call to the command object (`transferMoney(ctx, args)` → `app.transferMoney({ ...ctx, args })`);
  - `assert.ok(e instanceof HttpError); assert.equal(e.status, N)` → `assert.ok(e instanceof DomainError); assert.equal(httpStatusOf(e), N)`, so the class assertion stays next to the status. The frozen `HttpError` class is pinned separately by each `legacy.test.ts`;
  - `instanceof BankError` → `instanceof BankFailure`;
  - `staleProcessingMs()` → `staleProcessingMs(config.bankTimeoutMs)`.
- Moved tests default to the `x()` singleton (`const app = transfers()`), which is the same graph HTTP and tools use, with the system clock. Service tests use `wireX().internals` (one module-scope graph per file).
- `wireX({ clock, ids })` with `fixedClock(…)` / `sequentialIds(…)` from `tests/support/clock.ts` appears only inside dedicated `describe('… with a fixed clock')` blocks of new tests.
- Only `Clock` and `Ids` can be overridden (the `XOverrides` type allows nothing else). Registries, repos and the bank are always the real ones; `bankRequest` is never mocked.
- State a test mutates mid-file (bank stopped, index cleared, config field changed) is restored in `finally` or `after`, so a failing case cannot poison the next one.

#### 7a — Shared kernel, error mapping, characterization pins, ESLint layer scaffold (≈4 h)

| Old                                                                       | New                                                                                                                                | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —                                                                         | `src/shared/domain/errors.ts` + `errors.test.ts`                                                                                   | `DomainError` + 5 kinds; tests: message kept, `name` set, `kind` per class, no `status` property                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| —                                                                         | `src/shared/domain/bank-failure.ts` + test                                                                                         | `BankFailure`, `bankFailureKind`, `bankFailureFrom` (§10.4 tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `platform/config.ts:45` (`referenceDate`)                                 | `src/shared/domain/reference-date.ts`; `platform/config.ts` does `export { referenceDate } from '../shared/domain/reference-date'` | frozen `./config` export unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| —                                                                         | `src/shared/ports/{clock,ids,unit-of-work}.ts`                                                                                     | types only (not tested: no code)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| —                                                                         | `src/platform/runtime.ts` + `runtime.test.ts`                                                                                      | `systemClock`, `randomIds`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `platform/http/errors.ts`                                                 | same file                                                                                                                          | + `DomainError` branch, `httpStatusOf`, `toLegacyError`; TDD cases in `errors.test.ts`: one per kind (status + message), BankFailure keeps its status, `toLegacyError` → `HttpError`/`BankError` with the same status and message, any other value returned unchanged                                                                                                                                                                                                                                                                                                        |
| —                                                                         | `tests/support/clock.ts`                                                                                                           | `fixedClock(startIso = '2026-09-24T09:00:00.000Z')` with `advance(ms)`; `sequentialIds(prefix)`; added to the TESTING.md harness table                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| —                                                                         | `src/import-graph.test.ts`                                                                                                         | contract built on the TypeScript compiler API (`typescript` 5.9.3, `ts.createSourceFile`), not a regex. It walks every non-test `src/**/*.ts` and records value edges from `import … from`, side-effect `import '…'`, `export … from`, `export * from` and dynamic `import('…')`. It drops `import type` / `export type` and imports whose specifiers are all inline `type` (a mixed specifier list stays a value edge), handles multi-line imports, resolves relative paths to `x.ts` or the folder's `index.ts`, and asserts the graph has no cycle. Green on today's tree |
| `app/api/[...path]/route.test.ts`                                         | same file                                                                                                                          | + the **7a new** HTTP cases of §10.5 (status **and** `body.error` exact text) + the bank-failure pins (below). Characterization: green on today's code                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/assistant/tool-registry.test.ts`                                     | same file, new `describe('runTool error text')`                                                                                    | one case per tool error path, asserting `{ status: 'failed', error: <exact text> }`: operator ctx on `transfer_money`, foreign source, unknown destination, invalid amount (the observed ZodError text pinned as a literal; the schema is `transferMoneyTool.input`, exported by the transfers index, since lint forbids a deep import of `transferSchema`), `request_human` without conversation, `search_documents` without index, `list_accounts`/`operation_status` with the bank stopped (`No response received from the bank.`), unknown tool                          |
| `src/assistant/conversation.test.ts`, `src/support/operator-view.test.ts` | same files                                                                                                                         | add `assert.equal(e.message, '<exact text>')` to the existing status cases (#13, #14, #16) as **new** cases, so no existing body changes                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `eslint.config.mjs`                                                       | same file                                                                                                                          | layer areas + vertical rank (below); rules for `shared/`; `platform/` may import `shared/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| —                                                                         | `src/shared/AGENTS.md`                                                                                                             | docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Bank-failure pins (7a, characterization).** These pin the `BankError` → `BankFailure` → HTTP/tool path before 7b changes it. Each case asserts the status **and** the exact `body.error` or tool `error` text. Each restarts the bank in `finally` (or the file's `after`) so later cases see a live bank. The executor first runs each case on today's code and keeps the observed text; the expected values below are what the code reads as today.

| Case (file)                                                                                  | Expected                                                                                           |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/dashboard` as a customer with the bank stopped (`route.test.ts`)                   | 504 · `No response received from the bank.`                                                        |
| `POST /api/approvals/:id/confirm` with the bank stopped (`route.test.ts`)                    | 504 · `No response received from the bank.` (raised by the account check before dispatch)          |
| `POST /api/actions` `transfer_money` with the bank stopped (`route.test.ts`)                 | 200 · `{ status: 'failed', error: 'No response received from the bank.' }`                         |
| `operation_status` with an unknown reference (`tool-registry.test.ts`, `runTool error text`) | `{ status: 'failed', error: 'Operation not found.' }` (the bank's own 404 message, passed through) |

**ESLint generator (one config object per area × depth × test-or-not, so no two objects set the same rule on the same file):**

- **Areas, matched by glob:** `domain` `src/<v>/domain/**`, `application` `src/<v>/application/**`, `infrastructure` `src/<v>/infrastructure/**`, `wiring` `src/<v>/entry-points/{dependencies,legacy}.ts`, `entry-points` `src/<v>/entry-points/**` (ignoring the two `wiring` files), `index` `src/<v>/index.ts`. Also `flat`, which covers today's files in `src/<v>/**`, ignores the six layer globs, and keeps the Phase 6 `feature` rules; it is deleted at the end of 7d. Then `shared` `src/shared/**`, `platform` and `server`.
- `toSrc = up(depth)` and `toV = up(depth - 1)`, both fixed-depth strings (no `(\.\./)+`, which backtracks and lets `../../shared` match a "not shared" pattern). Depths 1–4 are generated.
- Every rule below is **core** `no-restricted-imports` (ESLint 9.39.5 supports `allowTypeImports` and `allowImportNames` per `paths`/`patterns` entry). No parallel `@typescript-eslint/no-restricted-imports` object, so one object per file sets the rule once.

| Area             | `no-restricted-imports` entries (non-test files)                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | `^${toSrc}(?!shared/domain(/\|$)\|types(\.ts)?$)` · `^${toV}(application\|infrastructure\|entry-points\|index)(/\|\.ts\|$)` · the purity package bans `^(better-sqlite3\|openai\|next\|dotenv)(/\|$)`, `^(node:)?(fs\|path\|os\|zlib\|http\|https\|net\|dns\|child_process\|worker_threads)(/.*)?$` · `paths: [{ name: 'node:crypto', allowImportNames: ['createHash'] }, { name: 'crypto', allowImportNames: ['createHash'] }]` |
| `application`    | `^${toSrc}(?!shared/\|types(\.ts)?$)` (no platform, no other vertical) · `^${toV}(infrastructure\|entry-points\|index)(/\|\.ts\|$)` · the purity package bans, except `openai` becomes `{ regex: '^openai(/\|$)', allowTypeImports: true }` · the same `node:crypto` entry                                                                                                                                                       |
| `infrastructure` | `^${toSrc}(?!platform/\|shared/\|types(\.ts)?$)` (no other vertical) · `^${toV}(application/(use-cases\|services)\|entry-points\|index)(/\|\.ts\|$)` (own ports and domain allowed)                                                                                                                                                                                                                                              |
| `wiring`         | `^${toSrc}platform/(?!http/\|config(\.ts)?$\|runtime(\.ts)?$)` · `^${toSrc}(<verticals>)/.+` (other verticals only through `index`) · the rank entries. Own `application/**` (use cases, services, ports), own `domain/` and own `infrastructure/` allowed                                                                                                                                                                       |
| `entry-points`   | the `wiring` entries · `{ regex: '^${toV}application/services(/\|$)' }` · `{ regex: '^${toV}application/ports(/\|$)', allowTypeImports: true }` · `{ regex: '^${toV}infrastructure(/\|$)' }` (only `dependencies.ts` and `legacy.ts` touch infrastructure). Own `application/use-cases` (types) and own `domain/` (schemas, types, constants) allowed                                                                            |
| `index`          | target `^\./(?!entry-points/)`; 7a ships the transitional `^\./(domain\|application\|infrastructure)(/\|$)`, because today's `index.ts` files still re-export flat files; tightened in 7d                                                                                                                                                                                                                                        |
| `shared`         | `^${up(depth)}(?!shared/)` (fixed depth) and the `domain` purity bans                                                                                                                                                                                                                                                                                                                                                            |
| `platform`       | unchanged (no vertical, no `server`); `shared/` allowed                                                                                                                                                                                                                                                                                                                                                                          |
| `server`         | unchanged until the end of 7d; then `^\.\./(<verticals>)/.+` (index only). One extra object for `src/server/seed.ts` **only** uses `^\.\./(<verticals>)/(?!infrastructure/).+`, so seed may reach `<v>/infrastructure/*` and nothing else deep (§10.10, C3)                                                                                                                                                                      |

- **Purity rules for `domain`, `application` and `shared/domain`**, in the same per-area objects:
  - `no-restricted-globals: ['error', { name: 'crypto', message: 'Use the Ids port.' }]`;
  - `no-restricted-syntax` selectors (merged with the Phase 6 dynamic-import selectors, since the last object wins):
    - `CallExpression[callee.object.name='Date'][callee.property.name='now']` → "Use the Clock port.";
    - `NewExpression[callee.name='Date'][arguments.length=0]` → "Use the Clock port." (`new Date(x)` with an argument is pure and allowed);
    - `CallExpression[callee.object.name='Math'][callee.property.name='random']` → "Use the Ids port.";
    - `MemberExpression[object.name='globalThis'][property.name='crypto']` → "Use the Ids port." (`no-restricted-globals` does not see `globalThis.crypto`).
- **Rank entries:** core-rule patterns with `allowTypeImports: true`, in the `wiring`, `entry-points`, `index` and `flat` objects of vertical `v`. They forbid `^${toSrc}(<verticals of rank ≥ rank(v), except v>)(/|$)`. They replace the Phase 6 "tool imports only types from assistant" object.
- **Today's two rank violations:**
  - `transfers/http/actions.ts` → `assistant`;
  - `conversations/http/conversations.ts` → `assistant`.

  Each gets an `// eslint-disable-next-line no-restricted-imports -- moves to assistant in 7b/7c` comment. Each comment is **deleted** in the commit that moves its handler, not moved with it: once the import is legal, an unused directive would add a warning above today's 5. 7c's acceptance requires `grep -rn "eslint-disable" src` to be empty.

- **Test files** (`*.test.ts`): only the cross-vertical index rule, the shim rule and the alias rule. The layer rules do not apply, so a use-case test may import its vertical's `entry-points/dependencies` and `tests/support/*`.
- **Outside `src/`:** the Phase 6 rule's regex becomes `src/(<verticals>)/(http|entry-points/http)(/|$)`.
- **Dynamic `import()`:** the Phase 6 selectors are kept, and the targets add `\x2F(?!index)` for the new layout.

**Step order:**

1. Write the characterization cases (route, tool text, messages) and see them green on today's code.
2. Write `import-graph.test.ts` and see it green.
3. TDD `shared/domain` and `bank-failure` (red, then green).
4. TDD `httpStatusOf`/`toLegacyError`/`toErrorResponse` (red, then green).
5. Add `runtime.ts` and `tests/support/clock.ts`.
6. Move `referenceDate`.
7. ESLint scaffold, then the fire-proofs.
8. Gates, docs, commit.

**Fire-proofs (7a):**

| Probe                                                                                                                                                                                                    | Expected                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/transfers/domain/__probe.ts`: `import '../application/use-cases/x'`                                                                                                                                 | domain → application error                                                                                                                |
| same file: `import '../../platform/config'`                                                                                                                                                              | domain → platform error                                                                                                                   |
| same file: `import Database from 'better-sqlite3'`, `import { randomUUID } from 'node:crypto'`                                                                                                           | two errors; `import { createHash } from 'node:crypto'` passes                                                                             |
| same file: `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`                                                                                                                            | four errors; `new Date('2026-09-24')` passes                                                                                              |
| `src/transfers/application/use-cases/__probe.ts`: `import '../../infrastructure/x'`, `import '../../../platform/db/statement'`, `import '../../../identity'`, `import '../../entry-points/dependencies'` | four errors; `import type { ResponseInputItem } from 'openai/resources/responses/responses'` passes, `import OpenAI from 'openai'` errors |
| same file: `new Date()`                                                                                                                                                                                  | error                                                                                                                                     |
| `src/transfers/infrastructure/__probe.ts`: `import '../application/use-cases/x'`, `import '../../identity'`                                                                                              | two errors; `import '../../platform/db/statement'` passes                                                                                 |
| `src/transfers/entry-points/dependencies.ts` (scratch copy): `import '../application/services/x'`, `import '../infrastructure/x'`                                                                        | both pass (M1)                                                                                                                            |
| `src/transfers/entry-points/http/__probe.ts`: `import '../../application/services/x'`                                                                                                                    | error (M1)                                                                                                                                |
| same file: `import '../../infrastructure/x'`                                                                                                                                                             | error (decision 7: only `dependencies.ts` / `legacy.ts` touch infrastructure)                                                             |
| same file: `import type { IntentRepository } from '../../application/ports/intent-repository'`, then the same without `type`                                                                             | type import passes; value import errors                                                                                                   |
| same file: `import { transferSchema } from '../../domain/transfer'`                                                                                                                                      | passes (decision 7)                                                                                                                       |
| `src/transfers/entry-points/tools/__probe.ts`: `import '../../infrastructure/x'`                                                                                                                         | error                                                                                                                                     |
| `src/transfers/entry-points/http/__probe.ts`: `import '../../../platform/db/statement'`, `import '../../../identity/application/use-cases/x'`, `import { runTool } from '../../../assistant'`            | three errors; `import type { Tool } from '../../../assistant'` passes                                                                     |
| `src/shared/domain/__probe.ts`: `import '../../platform/config'`; `src/shared/ports/__probe.ts`: `import '../../transfers'`                                                                              | two errors; `import '../domain/errors'` passes (fixed-depth regex)                                                                        |
| append `export * from './domain/x'` to a scratch copy named `src/transfers/index.ts` (then `git checkout`)                                                                                               | index error                                                                                                                               |

**Acceptance:**

- the common gates pass;
- every 7a characterization case is green on the **unchanged** application code, because 7a edits no handler, use case or tool;
- the 16 fire-proofs are recorded in the commit message.
- the four bank-failure pins are green on today's code and restore the bank in `finally`/`after`.

**Risks:**

- A characterization case hides a known bug, which TESTING.md forbids. Mitigation: each case states today's text only; P0/P1 findings are excluded.
- Flat-config option override. Mitigation: the generator emits exactly one object per (area, depth, test-or-not), and the fire-proofs prove it.

#### 7b — transfers (and the accounts/support callers of it) (≈8 h)

| Old                                                                                        | New                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transfers/intent-lifecycle.ts`                                                            | `domain/transitions.ts` (`TRANSITIONS`, `IntentStatus`, `predecessorsOf`, `IllegalTransitionError`) + `application/services/transition-intent.ts` (`makeTransitionIntent`: `compareAndSet(id, to, predecessorsOf(to), fields)`, then the same unknown-id / throw logic)                     |
| `transfers/intent-lifecycle.test.ts`                                                       | `application/services/transition-intent.test.ts` (+ new `domain/transitions.test.ts`)                                                                                                                                                                                                       |
| `transfers/intents.repo.ts` (+ test)                                                       | `infrastructure/sqlite-intents.repo.ts` (+ test); row types → `domain/intent.ts`                                                                                                                                                                                                            |
| `transfers/approvals.repo.ts` (+ test)                                                     | `infrastructure/sqlite-approvals.repo.ts` (+ test); row types → `domain/approval.ts`                                                                                                                                                                                                        |
| `transfers/authorization.ts`                                                               | `application/services/authorize-transfer.ts` + `domain/{holds,approval,transfer}.ts`                                                                                                                                                                                                        |
| `transfers/authorization.test.ts`                                                          | `application/services/authorize-transfer.test.ts` (`app.internals.authorizeTransfer(ctx, input)`)                                                                                                                                                                                           |
| `transfers/dispatch.ts`                                                                    | `application/services/dispatch-transfer.ts` + `domain/outcome.ts` (`DISPATCH_ATTEMPTS`, `shouldRetryDispatch`) + `infrastructure/in-memory-dispatch-registry.ts`                                                                                                                            |
| `transfers/dispatch.test.ts`                                                               | `application/services/dispatch-transfer.test.ts`                                                                                                                                                                                                                                            |
| `transfers/reconcile.ts` (+ test)                                                          | `application/use-cases/reconcile-intent.ts` (+ test, `app.reconcileIntent({ userId, intentId })`) + `domain/reconciliation.ts`                                                                                                                                                              |
| `transfers/transfer-money.ts`                                                              | `application/use-cases/transfer-money.ts` + `application/services/record-outcome.ts` + `domain/{transfer,outcome}.ts` + `entry-points/legacy.ts` (`transferMoney(ctx, args)` = `transfers().transferMoney({ ...ctx, args })` with `catch (e) { throw toLegacyError(e) }`; `transferSchema`) |
| `transfers/transfer-money.test.ts`                                                         | `application/use-cases/transfer-money.test.ts`                                                                                                                                                                                                                                              |
| `transfers/http/approvals.ts`                                                              | `entry-points/http/confirm-approval.ts` (`findProposal` → read and parse the body exactly as today → `confirmProposal`) + `use-cases/{find-proposal,confirm-proposal}.ts`                                                                                                                   |
| `transfers/http/actions.ts`                                                                | `assistant/http/run-action.ts` (old assistant layout; lands in entry-points in 7c). Its `eslint-disable` comment is **deleted**, not moved: the import is legal from `assistant`                                                                                                            |
| `transfers/tools/*.tool.ts` (+ tests)                                                      | `entry-points/tools/*.tool.ts` (+ tests); `operation_status` calls `GetOperationStatus`; `transfer_money` calls `transfers().transferMoney({ ...ctx, args })`                                                                                                                               |
| `accounts/http/dashboard.ts:pendingTransfers` and lines 35–38                              | `use-cases/{list-pending-transfers,list-live-proposals}.ts` + `domain/pending-transfer.ts`; the dashboard calls `transfers().listPendingTransfers` / `.listLiveProposals`                                                                                                                   |
| `support/operator-view.ts` lines 23–28                                                     | `use-cases/get-conversation-transfers.ts`; `operator-view.ts` calls `transfers().getConversationTransfers`                                                                                                                                                                                  |
| —                                                                                          | `application/ports/*.ts` (6), `infrastructure/{http-transfers-bank.adapter,sqlite-unit-of-work,telemetry-event-log}.ts`, `entry-points/dependencies.ts`, `entry-points/legacy.test.ts`                                                                                                      |
| `src/transfers/AGENTS.md`                                                                  | note: "`POST /api/actions` is served by `assistant/entry-points/http/run-action.ts`; the URL did not change"                                                                                                                                                                                |
| `transfers/index.ts`                                                                       | exports `transfers` (typed `TransfersApp`, no `internals`), `confirmApproval`, `transferMoneyTool`, `operationStatusTool`, `transferMoney`, `transferSchema` (from `entry-points/` only)                                                                                                    |
| `src/banking/actions.ts` (shim)                                                            | `export { transferMoney, transferSchema } from '../transfers'`                                                                                                                                                                                                                              |
| `server/seed.ts`, `server/routes.ts`, `tests/fixtures/factories.ts`, `tests/support/db.ts` | import paths: `insertIntent` from `transfers/infrastructure/sqlite-intents.repo` (seed); `confirmApproval` from `../transfers`; `runAction` from `../assistant/http/run-action`; row types from `transfers/domain/*`                                                                        |

**Step order (tests first):**

1. Write the §10.4 transfers domain tests and see them red. Create the `domain/*` files by moving code, and see them green.
2. Write `entry-points/legacy.test.ts`:
   - one case per frozen behaviour;
   - "should report a foreign source account as HttpError 403 through the frozen transferMoney";
   - "should report a bank failure as BankError with the bank's status through the frozen transferMoney";
   - "should keep transferSchema rejecting a transfer to the same account".

   These are green against the old `transfers/transfer-money.ts` through the shim.

3. Ports and adapters. Move the repos with `git mv` and add their adapter objects. The adapter test is "should translate a 404 into a not-found BankFailure with the bank's message" (real bank).
4. Services, then use cases, then `dependencies.ts`. Move the tests with the allowed edits. Add the new fixed-clock use-case tests:
   - "should expire the proposal ten minutes after the fixed clock";
   - "should settle a processing intent once the clock passes the stale window" (`fixedClock().advance(staleProcessingMs(…) + 1)`);
   - "should report the live proposals that are still valid at the clock time".
5. Entry-points (tools, http, legacy). Rewire the shim, `routes.ts`, dashboard, operator-view and seed. Move `actions.ts` to `assistant/http/run-action.ts` and delete its `eslint-disable` line.
6. `git rm` the emptied files. Then the gates and the fire-proofs, which re-run the 7a probes against real transfers files.

**Acceptance:**

- the common gates pass;
- `src/transfers/` holds only `index.ts`, `AGENTS.md` and the four layer folders;
- the following greps are empty:
  - `grep -rnE "HttpError|platform/" src/transfers/{application,domain}`;
  - `grep -rnE "new Date\(\)|Date\.now|randomUUID|Math\.random" src/transfers/{application,domain}`;
  - `grep -rln "internals" src | grep -v "\.test\.ts$" | grep -v "entry-points/dependencies\.ts$"`;
- `BankError` appears only in `transfers/infrastructure/http-transfers-bank.adapter.ts`;
- `statement(` and `atomically(` appear only in `transfers/infrastructure/`;
- the lossy-bank tests still give `unknown` → `completed`.

**Risks:**

- **Process state split.** A test or caller wires a second graph and loses the in-flight `dispatching` mark. Mitigation:
  - every entry-point and `legacy.ts` uses `transfers()`;
  - moved tests default to the `transfers()` singleton;
  - the reconcile "dispatch in flight" cases and the service tests run on one `wireTransfers()` graph per file and mark `internals.dispatching` on that graph.
- **Clock drift.** Today `now` (`authorization.ts:56`) and the expiry (`:87`) are two separate readings. Mitigation: two `clock.now()` calls, in the same places.
- **Status/message drift.** Mitigation: the 7a pins and the `legacy.test.ts` cases.

#### 7c — assistant (`ToolCatalog`, `KnowledgePort`, `ConversationLog`; the Part 2 seam) (≈5 h)

| Old                                                                | New                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant/conversation.ts`                                        | `application/use-cases/send-message.ts` + `domain/run-policy.ts` + `infrastructure/in-memory-conversation-locks.ts`                                                                                                                                                                                                                                                       |
| `assistant/conversation.test.ts`                                   | `application/use-cases/send-message.test.ts` (`app.sendMessage({ userId, conversationId, content })`)                                                                                                                                                                                                                                                                     |
| `assistant/loop.ts` (+ test)                                       | `application/services/run-agent-loop.ts` (+ test, through `wireAssistant().internals.runAgentLoop`); `maxRounds` imported from `domain/run-policy.ts`                                                                                                                                                                                                                     |
| `assistant/evidence.ts` (+ test)                                   | `application/use-cases/preview-answer.ts` (+ test)                                                                                                                                                                                                                                                                                                                        |
| `assistant/prompt.ts` (+ test)                                     | `domain/prompt.ts` (+ test, unit)                                                                                                                                                                                                                                                                                                                                         |
| `assistant/tool-registry.ts`                                       | `application/use-cases/run-tool.ts` + `application/ports/tool-catalog.ts` (`Tool`, `ToolCatalog`) + `infrastructure/static-tool-catalog.ts` + `entry-points/tools/catalog.ts` (`tools`) + `entry-points/dependencies.ts` (`toolDefinitions`, from the one `staticToolCatalog(tools)`; re-exported by `legacy.ts`) + `entry-points/tools/tool.ts` (`export type { Tool }`) |
| `assistant/tool-registry.test.ts`                                  | `describe('runTool')` and `describe('runTool error text')` → `application/use-cases/run-tool.test.ts`; `describe('toolDefinitions')` (golden) → `entry-points/tools/catalog.test.ts`                                                                                                                                                                                      |
| `assistant/strict-schema.ts` (+ test)                              | `infrastructure/strict-schema.ts` (+ test)                                                                                                                                                                                                                                                                                                                                |
| `assistant/runs.repo.ts` (+ test)                                  | `infrastructure/sqlite-runs.repo.ts` (+ test)                                                                                                                                                                                                                                                                                                                             |
| `assistant/http/preview-answer.ts`, `assistant/http/run-action.ts` | `entry-points/http/{preview-answer,run-action}.ts`; `run-action` checks ownership with the conversations index, as today                                                                                                                                                                                                                                                  |
| `conversations/http/conversations.ts:postMessage`                  | `assistant/entry-points/http/post-message.ts`: ownership (404) → body → rename if untitled → `assistant().sendMessage`, in today's order; uses the conversations index (`conversationFor`, rename) until 7d                                                                                                                                                               |
| —                                                                  | `application/ports/*.ts` (7), `infrastructure/{openai-model.adapter,telemetry-event-log}.ts`, `entry-points/{dependencies,legacy}.ts`, `entry-points/legacy.test.ts`                                                                                                                                                                                                      |
| `src/conversations/AGENTS.md`                                      | note: "`POST /api/conversations/:id/messages` is served by `assistant/entry-points/http/post-message.ts`; the URL did not change"                                                                                                                                                                                                                                         |
| `assistant/index.ts`                                               | exports `assistant` (typed `AssistantApp`, no `internals`), `previewAnswer`, `runAction`, `postMessage`, `type Tool`, `runTool`, `toolDefinitions`, `sendMessage`, `answerWithEvidence`                                                                                                                                                                                   |
| `src/agent/{run,tools}.ts` (shims)                                 | re-export from `../assistant`                                                                                                                                                                                                                                                                                                                                             |
| tools in `accounts`, `knowledge`, `transfers`, `support`           | `import type { Tool } from '<…>/assistant'` (index; type-only)                                                                                                                                                                                                                                                                                                            |

**Step order:**

1. Write the `run-policy`/`prompt` domain tests and see them red, then move the code.
2. Write `legacy.test.ts` against the old code:
   - "should report a missing conversation as HttpError 404 through the frozen sendMessage";
   - "should keep the tool definitions identical to the golden ones through the frozen toolDefinitions".
3. Ports and adapters. The `openai-model.adapter` test is "should send the agent turn body with today's fields in today's order" (fake OpenAI, comparing `JSON.stringify(fake.requests[0].body)` key order with today's literal).
4. Use cases and the service, then `dependencies.ts`. Move the tests. New fixed-clock test: "should stamp the user message and the run with the same clock time".
5. Entry-points. Move `post-message` and delete the `eslint-disable` line in `conversations/http/conversations.ts` (the one in `actions.ts` went in 7b). Rewire `routes.ts` and the shims.
6. Gates, plus fire-proofs on real assistant files.

**Part 2 seam:**

- A new agent capability is a tool file in the owning vertical's `entry-points/tools/`, calling that vertical's use case.
- It is appended to `entry-points/tools/catalog.ts`. Appending changes the golden on purpose, in the Part 2 commit, which lands after all of Phase 7 (7d included). Gate 6 diffs against each sub-phase's own base, so it stays valid afterwards.
- A new model-side behaviour is a new port in `assistant/application/ports/` with an adapter.

**Acceptance:**

- the common gates pass;
- `createResponse` and `toResponseInputItems` appear only in `assistant/infrastructure/`;
- `new Set` appears in `assistant/` only in `infrastructure/in-memory-conversation-locks.ts`;
- `grep -rn "eslint-disable" src` is empty;
- `grep -rln --include='*.ts' "internals" src | grep -v "\.test\.ts$" | grep -v "entry-points/dependencies\.ts$"` is empty;
- the loop wire test and the golden catalog test are green;
- `src/assistant/` holds only `index.ts`, `AGENTS.md` and the four layer folders.

**Risks:**

- **Wire drift in the model request.** Mitigation: the adapter copies the body literals verbatim; the golden test, the loop wire test and the new key-order test catch drift; Pablo runs `npm run doctor` once afterwards (it spends quota).
- **The `locks` instance is split between the HTTP route and `agent/run`.** Mitigation: both go through `assistant()`.
- **Cycle through `catalog.ts`.** Mitigation: the rank rule plus `import-graph.test.ts`.

#### 7d — knowledge, conversations, support, identity, then the accounts dashboard split (≈8 h; five commits, in this order)

7d is **five commits**, one per row below. Each commit passes the common gates on its own. Every consumer of the vertical being moved switches in that same commit (the "Consumers to switch" tables were built by grepping today's imports: `grep -rnE "from '[./]*(.*/)?<v>(/[^']*)?'" src app tests scripts`). Verticals not yet moved keep their flat layout and reach a moved vertical only through its `index.ts`.

**Common step order (per commit):**

1. Write the domain tests (§10.4) and see them red, then move the code.
2. Write `legacy.test.ts` against the old code, where the vertical has a shim.
3. Ports and adapters, then use cases and `dependencies.ts`, then entry-points and moved tests.
4. Switch every consumer in the commit's table.
5. Add the commit's `AGENTS.md`/`TESTING.md` updates, then the gates.

##### 7d.1 knowledge (≈2 h)

| Old                                                 | New                                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge/search/search.ts` (+ test)               | `application/use-cases/search-documents.ts` (+ test) + `domain/retrieval.ts`                                                                                                                                                    |
| `knowledge/search/embeddings.ts` (+ test)           | `infrastructure/cached-openai-embedder.ts` (+ test)                                                                                                                                                                             |
| `knowledge/search/store.ts` (+ test)                | `infrastructure/sqlite-chunk-store.ts` (+ test)                                                                                                                                                                                 |
| `knowledge/ingestion/chunker.ts` (+ test)           | `domain/chunker.ts` (+ test)                                                                                                                                                                                                    |
| `knowledge/ingestion/pipeline.ts`                   | `infrastructure/fixture-document-catalog.ts`, `infrastructure/index-snapshot.ts`, `application/use-cases/ingest-documents.ts`, `entry-points/legacy.ts` (`documents`, `readDocument`, `ingest(onProgress)`, `saveInitialIndex`) |
| `knowledge/ingestion/pipeline.test.ts`              | split by `describe`: `documents`/`readDocument` → `infrastructure/fixture-document-catalog.test.ts`; `ingest` → `application/use-cases/ingest-documents.test.ts`                                                                |
| `knowledge/http/{documents,search,ingestion}.ts`    | `entry-points/http/*.ts` + `use-cases/{list-documents,get-document,get-document-chunks}.ts`                                                                                                                                     |
| `knowledge/tools/search-documents.tool.ts` (+ test) | `entry-points/tools/` (+ test); the tool command sets `role: 'customer'`                                                                                                                                                        |

| Consumer to switch in this commit                                  | Today                                                                 | After                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assistant/entry-points/dependencies.ts` (`KnowledgePort`)         | `searchDocuments` from the knowledge index                            | `knowledge().searchDocuments({ query, role: 'customer' })`                                                                                             |
| `assistant/entry-points/tools/catalog.ts`                          | `searchDocumentsTool` from the knowledge index                        | unchanged import; the index now re-exports `entry-points/tools/search-documents.tool`                                                                  |
| `src/server/seed.ts:5`                                             | `documents`, `restoreIndex` from `../knowledge`                       | `documents` from `../knowledge` (legacy); `restoreIndex` from `../knowledge/infrastructure/sqlite-chunk-store`                                         |
| `src/server/seed.test.ts:5`                                        | `allChunks` from `../knowledge/search/store`                          | `../knowledge/infrastructure/sqlite-chunk-store`                                                                                                       |
| `src/server/routes.ts:18,20,21`                                    | `../knowledge/http/{documents,search,ingestion}`                      | `../knowledge` (index)                                                                                                                                 |
| `app/api/[...path]/route.test.ts:8`                                | `documents` from `src/knowledge/ingestion/pipeline`                   | `documents` from `src/knowledge` (index, legacy)                                                                                                       |
| `src/ingestion/pipeline.ts`, `src/retrieval/{store,embeddings}.ts` | `export *` from the flat knowledge files                              | `ingestion/pipeline` → `../knowledge` (legacy); `retrieval/*` → `../knowledge/infrastructure/{sqlite-chunk-store,cached-openai-embedder}` (§10.10, C6) |
| `scripts/ingest.ts:1`, `scripts/doctor.ts:1`                       | `src/knowledge/ingestion/pipeline`, `src/knowledge/search/embeddings` | `ingest`/`saveInitialIndex` from `src/knowledge`; `embedTexts` from `src/knowledge/infrastructure/cached-openai-embedder`                              |

##### 7d.2 conversations (≈1.5 h)

| Old                                                        | New                                                                                                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations/{conversations,messages}.repo.ts` (+ tests) | `infrastructure/sqlite-{conversations,messages}.repo.ts` (+ tests); row types → `domain/conversation.ts`                                                              |
| `conversations/ownership.ts`                               | `domain/conversation.ts:requireOwned` + `use-cases/get-owned-conversation.ts`                                                                                         |
| `conversations/http/conversations.ts`                      | `entry-points/http/conversations.ts` + `use-cases/{start-conversation,list-conversations,get-conversation-detail,title-conversation,append-message,list-messages}.ts` |

| Consumer to switch in this commit                            | Today                                                          | After                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `assistant/entry-points/dependencies.ts` (`ConversationLog`) | `conversationOf`, `insertMessage`, `messagesIn` from the index | `conversations().getOwnedConversation`, `.appendMessage`, `.listMessages`  |
| `assistant/entry-points/http/{run-action,post-message}.ts`   | `conversationFor` (and the rename) from the index              | `conversations().getOwnedConversation`, `.titleConversation`               |
| `src/support/operator-view.ts:2` (support still flat)        | `messagesIn` from `../conversations`                           | `conversations().listMessages({ conversationId })` from `../conversations` |
| `src/server/seed.ts:6`                                       | `insertConversation`, `insertMessage` from `../conversations`  | `../conversations/infrastructure/sqlite-{conversations,messages}.repo`     |
| `src/server/routes.ts:14`                                    | `../conversations/http/conversations`                          | `../conversations` (index)                                                 |
| `tests/fixtures/factories.ts:16-17`                          | `NewConversation`, `NewMessage` types from the repos           | `src/conversations/domain/conversation`                                    |

##### 7d.3 support (≈1.5 h)

| Old                                            | New                                                                                                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support/incidents.repo.ts` (+ test)           | `infrastructure/sqlite-incidents.repo.ts` (+ test); row types → `domain/incident.ts`                                                                                                           |
| `support/operator-view.ts` (+ test)            | `use-cases/get-case-detail.ts` (+ test, `app.getCaseDetail({ operatorId, incidentId })`) + `domain/case-evidence.ts` + `infrastructure/{telemetry-event-reader,http-operator-bank.adapter}.ts` |
| `support/http/incidents.ts`                    | `entry-points/http/incidents.ts` + `use-cases/{list-incidents,get-operator-workspace}.ts`                                                                                                      |
| `support/tools/request-human.tool.ts` (+ test) | `entry-points/tools/` (+ test; the conversationId check and parse stay in the tool, in that order) + `use-cases/request-human.ts`                                                              |

| Consumer to switch in this commit                        | Today                                     | After                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/accounts/http/dashboard.ts:3` (accounts still flat) | `allIncidents` from `../../support`       | the operator branch becomes `return json(support().getOperatorWorkspace())`; the customer branch is untouched until 7d.5 |
| `assistant/entry-points/tools/catalog.ts`                | `requestHumanTool` from the support index | unchanged import; the index now re-exports `entry-points/tools/request-human.tool`                                       |
| `src/server/seed.ts:7`                                   | `insertIncident` from `../support`        | `../support/infrastructure/sqlite-incidents.repo`                                                                        |
| `src/server/routes.ts:17`                                | `../support/http/incidents`               | `../support` (index)                                                                                                     |
| `tests/fixtures/factories.ts:20`                         | `NewIncident` type from the repo          | `src/support/domain/incident`                                                                                            |
| support's `People` port                                  | —                                         | wired to `person` from the identity index until 7d.4                                                                     |

##### 7d.4 identity (≈1.5 h)

| Old                                 | New                                                                                                                                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity/auth.ts` (+ test)         | `entry-points/http/session-guard.ts` (`actor`, `sameOrigin`; `HttpError`; `actor` calls `identity().verifySession`) + `infrastructure/hmac-session-tokens.ts`; `auth.test.ts` split by `describe` into `session-guard.test.ts` and `hmac-session-tokens.test.ts` |
| `identity/people.ts` (+ test)       | `infrastructure/people-roster.ts` (+ test)                                                                                                                                                                                                                       |
| `identity/http/{people,session}.ts` | `entry-points/http/*.ts` + `use-cases/{list-people,start-session,find-person,verify-session}.ts`; `entry-points/legacy.ts` (`sessionToken`, `actor`, `sameOrigin`, `people`, `person`)                                                                           |

| Consumer to switch in this commit                                                                                 | Today                                    | After                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auth.ts` (shim)                                                                                              | `export * from './identity/auth'`        | `sign`, `equal` from `./platform/crypto`; `HttpError` from `./platform/http/http-error`; `sessionToken`, `actor`, `sameOrigin` from `./identity` (legacy) |
| `src/people.ts` (shim)                                                                                            | `export * from './identity/people'`      | `people`, `person` from `./identity` (legacy)                                                                                                             |
| `app/api/[...path]/route.test.ts:7`, `tests/support/api.ts:4`                                                     | `sessionToken` from `src/identity/auth`  | `sessionToken` from `src/identity` (index, legacy)                                                                                                        |
| `src/server/handle.ts:1`                                                                                          | `actor`, `sameOrigin` from `../identity` | unchanged import; the index now re-exports `entry-points/http/session-guard`                                                                              |
| `src/server/routes.ts:6-7`                                                                                        | `../identity/http/{people,session}`      | `../identity` (index)                                                                                                                                     |
| `transfers/entry-points/dependencies.ts` (`CustomerDirectory`), `support/entry-points/dependencies.ts` (`People`) | `person` from the identity index         | `identity().findPerson({ id })`                                                                                                                           |

##### 7d.5 accounts and the dashboard split (≈1.5 h)

| Old                                             | New                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts/http/dashboard.ts`                    | `accounts/entry-points/http/dashboard.ts`: `actor.role === 'operator' ? support().getOperatorWorkspace() : accounts().getCustomerOverview({ userId })` + `use-cases/get-customer-overview.ts` + `infrastructure/http-accounts-bank.adapter.ts` |
| `accounts/tools/list-accounts.tool.ts` (+ test) | `entry-points/tools/` (+ test) + `use-cases/list-accounts.ts`                                                                                                                                                                                  |

| Consumer to switch in this commit         | Today                                      | After                                                                                  |
| ----------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `src/server/routes.ts`                    | `../accounts/http/dashboard`               | `../accounts` (index)                                                                  |
| `assistant/entry-points/tools/catalog.ts` | `listAccountsTool` from the accounts index | unchanged import; the index now re-exports `entry-points/tools/list-accounts.tool`     |
| `eslint.config.mjs`                       | `flat` area; `server` area as in Phase 6   | delete `flat`; tighten `server` to index-only plus the seed-only infrastructure object |

**Fixed-clock tests (7d):** "should date a new conversation at the clock time" (7d.2); "should open the incident at the clock time" (7d.3).

**Final fire-proofs (7d.5):**

- `src/server/routes.ts` with `import '../transfers/application/use-cases/x'` errors;
- `src/server/handle.ts` with `import '../identity/infrastructure/people-roster'` errors;
- `src/server/seed.ts` with `import '../support/infrastructure/sqlite-incidents.repo'` passes, and with `import '../support/application/use-cases/x'` errors.

**Acceptance (the final state of Phase 7):**

- the common gates pass after each of the five commits;
- `find src/{transfers,accounts,assistant,conversations,knowledge,support,identity} -mindepth 1 -maxdepth 1` lists only `index.ts`, `AGENTS.md`, `entry-points`, `application` and, where present, `domain` and `infrastructure`;
- `grep -rn "new HttpError(" src` finds exactly the 10 transport sites of §10.5;
- `grep -rnE "HttpError|platform/" src/*/{application,domain}` is empty;
- `grep -rnE "new Date\(\)|Date\.now|randomUUID|Math\.random" src/*/{application,domain} src/shared` is empty (`new Date(x)` with an argument is allowed);
- `grep -rln "internals" src | grep -v "\.test\.ts$" | grep -v "entry-points/dependencies\.ts$"` is empty;
- the `flat` lint area is gone;
- every `index.ts` re-exports only from `./entry-points/`;
- the `index` lint regex is tightened to `^\./(?!entry-points/)`.

**Risks:**

- **A consumer missed in a commit.** Mitigation: the per-commit consumer tables; typecheck and `import-graph.test.ts` fail on a dangling path; the grep above is re-run before each commit.
- **The search role default.** `search_documents` passes no role today, so the default is `customer`. Mitigation: the tool command sets `role: 'customer'` explicitly.
- **Ingest progress callback.** Mitigation: `legacy.ingest(onProgress)` keeps the callback, and `IngestDocuments` takes it in the command.
- **Path checks in `readDocument`.** Mitigation: moved verbatim; the `pipeline.test` cases move with it.
- **Dashboard ordering.** Mitigation: `GetCustomerOverview` keeps `Promise.all` of 4, then the proposals; route tests and the 7a bank-stopped pin fix the shape and the error.

#### Effort, overrun rule and checkpoints

Scope is fixed: **all of 7a–7d lands before Part 2** (user decision). The first estimate (18 h) assumed no overrun. The critic expected 1.3–1.5× on refactors of this size, so the plan carries a realistic estimate instead:

| Sub-phase                                     | First estimate | Realistic estimate | Cumulative (realistic) | Overrun threshold (1.5× realistic) |
| --------------------------------------------- | -------------: | -----------------: | ---------------------: | ---------------------------------: |
| 7a kernel, mapping, pins, lint                |            3 h |                4 h |                    4 h |                                6 h |
| 7b transfers                                  |            6 h |                8 h |                   12 h |                               12 h |
| 7c assistant                                  |            4 h |                5 h |                   17 h |                              7.5 h |
| 7d five commits (2 + 1.5 + 1.5 + 1.5 + 1.5 h) |            5 h |                8 h |               **25 h** |                               12 h |

Expected range: 24–27 h.

- **Overrun rule (§3).** A sub-phase that passes 1.5× its realistic estimate stops and reports to Pablo: time spent, what is left, and why. Because scope is fixed, the report asks for time, not a cut. The only fallback is to land the sub-phases already green; each one is self-contained.
- **Checkpoints after 7b and 7c are status checkpoints, not stop points.** The executor posts the time spent against the cumulative estimate (12 h, then 17 h), the test count, and any drift. It then continues without waiting.
- Every commit is reversible with `git revert` (no schema change, no data migration).

### 10.7 Overall risks

| Risk                                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Behaviour drift in error texts                              | Every one of the 26 `HttpError` sites, the 13 plain `Error` sites and the bank messages is pinned before it moves (7a). Messages are constants next to their rule. `DomainError` keeps `message`; `toErrorResponse` maps it to today's status; the tool runner's `e.message` line is unchanged; `toLegacyError` keeps the classes frozen-surface callers catch.                                                                                                                                                                                                                                                                                                                             |
| Shared process state between the HTTP and tool entry-points | `dispatching` and `locks` become adapters created once per graph. The process graph is the `x()` singleton, and every entry-point and `legacy.ts` function goes through it, so the HTTP confirm, the `transfer_money` tool, the dashboard reconcile and the case-detail reconcile share one registry, as the module-level `Set` does today. `wireX()` graphs are for tests only, one per file.                                                                                                                                                                                                                                                                                              |
| ESM cycles via `dependencies.ts`                            | **Invariant:** the value-import graph of `src/` is acyclic; across verticals it follows the rank table (§10.1), and accessors are only called inside functions, never at module evaluation. Enforced by: (1) the rank entries (core `no-restricted-imports`, `allowTypeImports: true`); (2) `index.ts` may re-export only `./entry-points/`; (3) application, domain and infrastructure cannot import another vertical at all; (4) `src/import-graph.test.ts` fails on any value cycle.                                                                                                                                                                                                     |
| Next dev HMR and the singleton                              | `let graph` in `dependencies.ts` has exactly the lifetime of today's module-level `dispatching`/`locks` `Set`s. A dev hot reload re-evaluates the module and starts empty, as today, and production (`next start`) holds one graph per process. No `globalThis` (non-goal); the e2e stack edits no file during a run.                                                                                                                                                                                                                                                                                                                                                                       |
| Test isolation with per-file wiring                         | node:test runs each file in its own process, so singletons never leak across files. Inside a file, moved tests use the `x()` singleton (the same graph HTTP and tools use); `wireX({ clock, ids })` appears only in dedicated fixed-clock `describe` blocks, and service tests use one `wireX().internals` graph. State mutated mid-file (bank stopped, index cleared) is restored in `finally`/`after`. `fixedClock` never reaches `platform/bank/client.ts`, which keeps `Date.now()` for the signed `x-bank-time`. Rows sharing one fixed timestamp still order by `rowid`, and new tests do not assert order on `conversationsOf` under a fixed clock (it orders by `created_at` only). |
| Lint scaffolding silently not firing                        | One config object per (area, depth, test-or-not); probes per rule in every sub-phase; probe and message tables in the commit messages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Budget                                                      | Realistic 25 h (24–27 h); the full Phase 7 lands before Part 2; status checkpoints after 7b and 7c; overrun report at 1.5× per sub-phase.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 10.8 Non-goals

- No behaviour change: statuses, messages, response shapes, check order, bank call order, model request bodies and tool definitions all stay byte-identical. Readiness fixes stay in their own TDD commits.
- No edit to `simulator/` or `fixtures/`, no change to `tests/fixtures/tool-definitions.ts` or `src/public-surface.test.ts`, no schema migration.
- No DI container library: manual factories and one `dependencies.ts` per vertical.
- No `globalThis` singleton, and no attempt to make process state survive HMR or multiple processes (that is P2-1).
- No new `DomainError` kind without a throw site (no `Unauthorized`: the 401s are transport and stay `HttpError`).

### 10.9 Counts

- 33 use cases: transfers 8, accounts 2, assistant 3, conversations 7, knowledge 5, support 4, identity 4 (`VerifySession` added in review).
- 31 ports: shared 3, transfers 6, accounts 2, assistant 7, conversations 2, knowledge 3, support 6, identity 2.
- 26 `new HttpError(` sites: 16 become a `DomainError`, 10 stay transport.
- 4 `BankError` sites: the 3 in `platform/bank/client.ts` are unchanged (adapters translate them), and only `transfers/dispatch.ts:36` becomes a `BankFailure`.
- 13 plain `Error` sites keep their class.
- Commits: 7a 1, 7b 1, 7c 1, 7d 5 (8 in total).

### 10.10 Where the approved design met the code, and how it was resolved

- **C1. Two runtime cycles.**
  - `POST /actions` (in `transfers`) runs `assistant.runTool`.
  - `POST /conversations/:id/messages` (in `conversations`) runs `assistant.sendMessage`.

  With `index.ts` re-exporting handlers, both would close a cycle with `assistant`'s ports. Resolved: both handlers move to `assistant/entry-points/http/`, with the same URLs and the same check order (user decision 4; noted in `src/transfers/AGENTS.md` and `src/conversations/AGENTS.md`). The vertical rank makes the graph a DAG by construction.

- **C2. Role gates precede body parsing** in `actions`, `preview-answer`, `ingestion`, `incidents` and `conversations` (pinned by `route.test.ts`). Moving them into use cases would reorder 403 and 400. Resolved: they stay in the http entry-points as `HttpError`, and only rules that run after parsing become `DomainError`s. The same reason splits `POST approvals/:id/confirm` into `FindProposal` (404s), the body parse and `ConfirmProposal`, and makes the conversations-messages flow call `GetOwnedConversation` before the parse.
- **C3. `server/seed.ts` writes into four verticals' tables** (`insertIntent`, `insertConversation`, `insertMessage`, `insertIncident`, `restoreIndex`, `documents`), but `index.ts` exports entry-points only. Resolved: one scoped lint object, matching `src/server/seed.ts` only, lets it import `<v>/infrastructure/*` and nothing else deep; fire-proofs show `routes.ts` and `handle.ts` still fail. Seed is a fixture loader, like `tests/support/db.ts`, and wires nothing.
- **C4. `transfer_money` checks the customer role before parsing** (`transfer-money.ts:67-69`). Resolved: `TransferMoneyCommand` carries the raw `args`, and the use case calls the pure `parseTransfer` after the role check. `request_human` keeps its conversationId check and parse in the tool entry-point, in today's order.
- **C5. The domain needs `createHash`** (`chunkDocument`) and `referenceDate` (`prompt`, retrieval). Resolved:
  - `domain/` and `application/` may import only `createHash` from `node:crypto` (`allowImportNames: ['createHash']`); the `crypto` global, `Date.now()`, zero-argument `new Date()` and `Math.random()` are banned there by lint (M4);
  - `referenceDate` moves to `shared/domain`, and `platform/config` re-exports it, so the frozen `./config` export is kept.
- **C6. The shims for `retrieval/*` and `banking/client` export infrastructure functions**, not behaviour. Resolved: those shims re-export the infrastructure or platform module directly. The behavioural shims delegate to `legacy.ts` entry-points that translate errors with `toLegacyError`: `banking/actions`, `agent/run`, `agent/tools`, `ingestion/pipeline`, `auth` and `people`.
- **C7. Existing tests assert `instanceof HttpError` and `instanceof BankError`** on internal functions (`authorization`, `dispatch`, `transfer-money`, `conversation`, `operator-view`). Resolved: the allowed mechanical edits (`instanceof DomainError` + `httpStatusOf(e)`, `BankFailure`) keep both the class and the status assertion, and every leaf title is unchanged. The frozen-class behaviour is pinned separately in each `legacy.test.ts`.
- **C8. Entry-points need their own `domain/`** for tool input schemas (`transferSchema`) and frozen exports. Resolved: entry-points may import their own domain (schemas, types, constants). Own infrastructure is reachable only from `dependencies.ts` and `legacy.ts`; an http handler or tool importing it fails lint (fire-proof in 7a). Own `application/services` is reachable only from `dependencies.ts`; other entry-points may import port **types** only (M1).
- **C9. The application needs OpenAI types** (`ResponseInputItem`, `FunctionTool`) for the loop. Resolved: type-only imports of `openai` are allowed in `application/` (erased), and value imports stay in `infrastructure/`.
- **C10. `IllegalTransitionError` is not a `DomainError`.** It escapes only on a bug, and today that is a 500. Making it a `ConflictError` would change it to a 409.
- **C11. The identity port lacked verification.** `actor` checks the cookie signature, but `SessionTokens` only issued tokens. Resolved: `SessionTokens.verify(token)` plus a `VerifySession` use case. `sign` and `equal` stay platform primitives, re-exported directly by the `src/auth.ts` shim.

### 10.11 Review log (critic: APPROVE WITH CHANGES; user decisions applied)

**User decisions on the open questions**

| #   | Decision                                                                                       | Where applied                                           |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Seed lint exception, `src/server/seed.ts` → `<v>/infrastructure/*` only                        | ESLint table (`server`), 7d.5 fire-proofs, C3           |
| 2   | `node:crypto` in domain: `createHash` only via `allowImportNames`, plus the M4 bans            | ESLint table, purity rules, 7a fire-proofs, C5          |
| 3   | The 10 transport `HttpError`s stay                                                             | §10.5 (unchanged)                                       |
| 4   | Actions and messages handlers move to `assistant`, same URLs, noted in both `AGENTS.md` files  | §10.1, 7b and 7c move tables, C1                        |
| 5   | Full Phase 7 before Part 2                                                                     | Status line, effort section                             |
| 6   | `internals` only for service tests, hidden from the index accessor type, grep-checked          | §10.3 template, 7b/7c/7d acceptance                     |
| 7   | Entry-points may import own domain; own infrastructure only from `dependencies.ts`/`legacy.ts` | ESLint table (`wiring`/`entry-points`), fire-proofs, C8 |
| 8   | Part 2 changes the golden in its own commit after Phase 7; gate 6 diffs against `$BASE`        | Common gates 0 and 6, 7c Part 2 seam                    |

**Critic findings**

| Finding                                      | Resolution                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 entry-point rules too coarse              | Separate `wiring` area for `dependencies.ts`/`legacy.ts`; other entry-points ban services and infrastructure, allow port types; fire-proofs both ways |
| M2 7d not green per commit                   | 7d split into five commits with grep-verified "Consumers to switch" tables                                                                            |
| M3 no bank-failure pins                      | Four 7a pins (dashboard, confirm, `transfer_money` via actions, `operation_status` 404), state restored in `finally`/`after`                          |
| M4 domain/application purity unenforced      | `allowImportNames` for crypto, `no-restricted-globals`, three `no-restricted-syntax` selectors, final 7d grep                                         |
| m1 BankError miscount                        | §10.5 and §10.9 say only `dispatch.ts:36` changes                                                                                                     |
| m2 `Pick<Config>` in application             | Structural `TransfersSettings` / `KnowledgeSettings` in `application/ports`                                                                           |
| m3 parallel `@typescript-eslint` rule        | Core rule only, per-pattern `allowTypeImports` (verified in `node_modules/eslint` 9.39.5)                                                             |
| m4 backtracking shared regex                 | Fixed-depth `^${up(depth)}(?!shared/)`; fire-proof added                                                                                              |
| m5 rank table wording                        | "any lower rank"                                                                                                                                      |
| m6 `eslint-disable` moved instead of deleted | Deleted in 7b (actions) and 7c (conversations)                                                                                                        |
| m7 gate 6 base                               | `BASE=$(git rev-parse HEAD)` per sub-phase                                                                                                            |
| m8 identity verify, `sign`/`equal`           | `SessionTokens.verify`, `VerifySession` use case, shim re-exports from `platform/crypto` (C11)                                                        |
| m9 entry-points own domain                   | Decision 7                                                                                                                                            |
| m10 test wiring and overrides                | Singleton by default; `wireX({ clock, ids })` only in fixed-clock blocks; `DispatchRegistry` no longer overridable (`XOverrides`)                     |
| m11 missing shapes                           | `FindProposal`/`ConfirmProposal` shapes in §10.2; `wireAssistant().internals.runAgentLoop`                                                            |
| m12 regex import graph                       | `import-graph.test.ts` on the TypeScript compiler API, with the listed syntax cases                                                                   |
| m13 mid-file state                           | Restored in `finally`/`after` (moved-test rules, risks)                                                                                               |
| m14 class assertion lost                     | `instanceof DomainError` kept next to `httpStatusOf(e)`; `legacy.test.ts` pins `HttpError`                                                            |
| m15 operator-view line                       | `People` lines 15, 41                                                                                                                                 |
| m16 AGENTS.md note                           | Decision 4                                                                                                                                            |

Nothing from the review is left open.
