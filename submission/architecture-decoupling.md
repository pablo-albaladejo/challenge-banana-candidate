# Plan: architecture decoupling

Status: approved 2026-10-09, all five phases in scope. Executed phase by phase, one commit each.

Goal: separate transport (HTTP), application services, persistence, and external integrations (bank, model) so the pending production-readiness fixes (`submission/production-readiness.md`) and the Part 2 feature land in one obvious place each, without growing `route.ts` or `run.ts`.

Rule for every phase: **behaviour-preserving refactor**. Existing tests keep passing with only import changes; new units (route table, migrations, intent state machine, tool registry) are written test-first. One commit per phase, hooks green.

## Current coupling (evidence)

| Smell                                                                                        | Where                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| God handler: string routing + inline SQL + validation + auth + error mapping, `as any`       | `app/api/[...path]/route.ts` (233 lines)                                                                                                    |
| SQL scattered in 9 modules, all positional inserts, no migrations                            | `route.ts`, `run.ts`, `tools.ts`, `actions.ts`, `authorization.ts`, `reconcile.ts`, `telemetry.ts`, `view.ts`, `seed.ts`; schema in `db.ts` |
| Intent lifecycle spread over 4 files, statuses as bare strings                               | `actions.ts`, `authorization.ts`, `dispatch.ts`, `reconcile.ts`                                                                             |
| Agent loop mixes persistence, locking, retrieval, model calls, tool dispatch, error text     | `src/agent/run.ts`                                                                                                                          |
| Tools: JSON schema hand-written separately from the zod schema that validates it; one switch | `src/agent/tools.ts`                                                                                                                        |
| OpenAI client reached from retrieval module; no single place for deadline/usage              | `src/retrieval/embeddings.ts` → used by `run.ts`                                                                                            |
| Config read at import time (dotenv relative to cwd); tests mutate it                         | `src/config.ts`, `tests/support/network.ts`                                                                                                 |
| 1002-line client component                                                                   | `app/page.tsx`                                                                                                                              |

## Target shape (feature-first, plain functions, no DI framework)

```
src/
  config.ts            loadConfig(env) + config singleton
  db/                  connection, migrations (PRAGMA user_version), one repo module per table group
    migrations.ts
    conversations.ts   messages.ts  runs.ts  intents.ts  approvals.ts  incidents.ts  events.ts  chunks.ts
  http/                transport only
    router.ts          route table {method, pattern, handler} + param matching
    context.ts         request context: actor, requestId
    errors.ts          error → Response mapper (the current catch block)
    handlers/          session, dashboard, conversations, actions, approvals, incidents, documents, search, preview, ingestion, health
  banking/
    bank.ts            typed port over bankRequest: accounts(), contacts(), movements(), transfer(), operation()
    intents.ts         intent lifecycle: statuses, allowed transitions, single `transition()` writer
    actions.ts / authorization.ts / dispatch.ts / reconcile.ts   use intents.ts + repos
  agent/
    model.ts           model gateway: responses.create, embeddings; one place for deadline, retries, usage
    tools/             registry: one module per tool {name, description, schema (zod), execute}; JSON schema derived with z.toJSONSchema
    loop.ts            model ↔ tool rounds, no SQL
    conversation.ts    sendMessage: lock, persist run/messages, call loop
app/api/[...path]/route.ts   ~15 lines: resolve route, run handler, map errors
app/(ui)/…                    page.tsx split into panels + api client
```

References: model gateway as its own architecture step (Book 3 · Ch 10, step 3 "Model Router and Gateway"); tool registry for agents (Book 5 · tool and agent registry, p. 345); pipeline decoupling (Book 4 · Ch 1, FTI).

## Phases

### Phase 1 — Config and persistence foundation (S-M)

- `loadConfig(env)` returning a frozen object; `config` = `loadConfig(process.env)`. Tests that swap `bankUrl` keep working (network proxy uses a setter or `withConfig`).
- `db/migrations.ts`: migration 1 = current schema verbatim; `PRAGMA user_version`. Test: fresh DB reaches latest version; an existing v0 DB with data is upgraded without loss.
- Repos with named-column SQL; callers switch from inline SQL. No behaviour change.
- Unlocks: P2-2, P2-4, P1-5 test.

### Phase 2 — HTTP layer (M)

- `http/router.ts` route table with method + pattern (`conversations/:id/messages`), tested in isolation (match, 404, 405).
- One handler module per resource, each owning its zod body schema and role check.
- `http/errors.ts` = current catch block; add `requestId` plumbing point (logging itself stays for P1-7).
- `route.ts` becomes a thin adapter. Existing `route.test.ts` is the characterization suite: it must pass untouched.
- Unlocks: P2-7, and the dashboard reconcile (P0-3) lands in `handlers/dashboard.ts`.

### Phase 3 — Banking: bank port + intent lifecycle (M)

- `banking/bank.ts`: typed functions over `bankRequest`; the response-parsing path lives in one place (where P0-1 will be fixed). Tests keep using the real bank; nothing is mocked.
- `banking/intents.ts`: `IntentStatus` union, transition table, `transition(id, from[], to, fields)` with a conditional `UPDATE … WHERE status IN (…)`. Test-first: allowed and forbidden transitions.
- `actions`, `authorization`, `dispatch`, `reconcile` call `transition` instead of raw UPDATEs.
- Unlocks: P0-1..P0-4 as small, local changes.

### Phase 4 — Agent: model gateway, tool registry, loop split (M)

- `agent/model.ts`: wraps `responses.create` and embeddings (moves the OpenAI client out of retrieval). Single place for deadline and usage (P1-4, P1-7).
- `agent/tools/*`: registry; `toolDefinitions` generated from the zod schemas (one source of truth, `strict` kept). Test: every definition matches its schema; unknown tool → failed.
- `run.ts` → `conversation.ts` (lock, persistence, error text) + `loop.ts` (rounds, tool calls, no SQL).
- Unlocks: P1-1..P1-4, P2-9, and Part 2 tools plug in as one file.

### Phase 5 — UI split (M)

- `app/page.tsx` → panels (customer overview, chat, transfers + approvals, operator inbox, case detail, documents) + typed `api` client. E2E suite is the safety net.

## Out of scope

- Behaviour fixes from the readiness review (they follow, with TDD, on top of this).
- Classes/DI containers, MCP, multi-process locks, changes to `simulator/` or `fixtures/`.

## Risks

- Large diff in `route.ts` → mitigated by keeping `route.test.ts` unchanged as characterization.
- `z.toJSONSchema` output may differ from the hand-written strict schema → snapshot-compare before switching.
- Migrations on existing `.data`: migration 1 uses `IF NOT EXISTS`, so v0 DBs upgrade in place.
