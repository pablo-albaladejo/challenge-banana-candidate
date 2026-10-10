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
