# Submission

Evaluator entry point for the Banana Bank challenge. Draft written 2026-10-11 against `main` at `f13e833`. Items marked **TODO** are unfinished or unverified and are owned by Pablo; nothing below reports a result that was not produced.

- Submission version/date: **TODO** final Git commit SHA and date, filled at packaging time.
- Challenge brief: [`../docs/challenge.md`](../docs/challenge.md). Project setup: [`../README.md`](../README.md).

## Contents of this folder

| Path                                                       | Status                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `README.md`                                                | This file                                                           |
| [`production-readiness.md`](production-readiness.md)      | Part 1 evidence: review with prioritised findings and what is fixed |
| [`part2-design.md`](part2-design.md)                       | Part 2 design, decisions log, demo script and implementation plan   |
| [`architecture-decoupling.md`](architecture-decoupling.md) | Plan and record of the architecture refactor (Phases 1 to 7)        |
| [`ai-sessions.md`](ai-sessions.md)                         | How AI was used (summary only; does not replace the exports)        |
| [`video-script.md`](video-script.md)                       | Script and click-by-click steps for the demo video                  |
| `ai-sessions/` or `ai-sessions.zip`                        | **TODO** original session exports (required; see below)             |
| `demo.mp4`                                                 | **TODO** recorded from `video-script.md`                            |
| `transcript.vtt`                                           | **TODO** optional                                                   |

Before packaging, every path above that is not marked TODO must exist, and every TODO row must either exist or be removed from this table.

## Part 1 - Prepare for Monday

**Approach.** Characterise first (tests pin current behaviour), fix with a failing test first, then review the whole application side for what remains. Problems were chosen by risk to money and to customer trust: the transfer path, grounding of answers, and the operator's evidence. The full list of what was checked, what is correct and what is still open is in [`production-readiness.md`](production-readiness.md).

### Fixes made (all on `main`, one commit each)

| Area                 | Problem                                                                                      | Fix (commit)                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Transfers            | A transfer executed with no customer confirmation                                            | `transfer_money` only creates a 10-minute proposal; money moves only on confirm (`409a1f3`)              |
| Transfers            | Same-account and unknown-destination transfers were proposed                                 | Rejected before proposing (`f8738fc`)                                                                    |
| Transfers            | Retrying a completed intent called the bank again and could flip it to `failed`              | Retry answered from the record (`77ff01b`)                                                               |
| Transfers            | A new bank reference per retry risked double payment                                         | One bank reference per intent (`c58fe72`)                                                                |
| Bank integration     | A lost response was recorded as `failed` although the bank had committed it                  | Unconfirmed outcomes become `unknown` and are reconciled with the bank (`99659a1`)                       |
| Bank integration     | Ambiguous outcomes and duplicates were not settled with the bank                             | Every ambiguous transfer settled with the bank; duplicates held (`149bd39`)                              |
| Agent                | Answers filled gaps with generic banking practice, no citations                              | Cited `[documentId vversion]` references, valid versions only, missing evidence acknowledged (`1ad39d8`) |
| Agent                | Malformed tool arguments ran the tool with `{}`; round-limit exhaustion looked like success  | Reported as errors / incomplete runs (`28b4d55`, `81d766a`)                                              |
| Agent                | Conversation ownership not checked inside `sendMessage`                                      | Checked in the agent path (`0a9f7fe`)                                                                    |
| Retrieval            | Only the first chunk carried metadata, so expired versions could not be filtered             | Every chunk labelled; search returns only versions in force on 24 September 2026 (`345799d`)             |
| Ingestion            | Behaviour on a failed embeddings batch was unspecified                                       | Index preservation and cache resume pinned by tests (`ff97cbf`)                                          |
| Operator             | Case detail returned empty history, events, intents and bank data                            | Full conversation, events, intents and bank evidence; missing evidence listed as `gaps` (`bc3cc62`)      |
| Security             | Cross-site POST without an `Origin` header got through                                       | `Sec-Fetch-Site: cross-site` rejected (`efe364c`)                                                        |
| HTTP                 | Wrong methods, trailing path segments and role-after-body ordering                           | 405 with `Allow`, exact paths, role checked before body (`420cbed`)                                      |
| Observability        | Events dropped tool arguments, output, error and duration                                   | Kept (`d93fae5`)                                                                                         |
| Production start     | Production deploys silently used public default secrets (readiness P1-5)                     | `npm start` exits 1 with default, short or reused secrets (`f13e833`)                                    |
| Model availability   | No OpenAI credit blocks every chat path                                                      | Opt-in `claude-cli` provider with lexical search fallback (`966f5e0`, `55b0e8a`, `502fa3e`)              |

How each was verified: every fix commit message states its test; the suite is `node:test` against the real simulator over HTTP and a scripted fake OpenAI (see [`../TESTING.md`](../TESTING.md)), and lost-response behaviour is reproduced with the lossy network proxy in `tests/support/network.ts`.

**TODO (Pablo):** a reproducible before/after check per headline fix. Suggested: for `99659a1`, run `npm run scenario -- lost-response` on the starter commit `726b592` and on this one, and record the intent status and bank operation count. Not run in this draft.

### Known open findings

Documented but not fixed, in priority order (see the doc for evidence and effort): P0-5 DNS rebinding / Host allowlist, P0-6 raw account ids on the proposal card, P0-7 the open persona selector (any visitor can become an operator; accepted for the demo, a launch blocker). Several P0 items on unknown-intent handling overlap with the banking commits above; the document's own status line is authoritative and is being revised in parallel. **TODO:** confirm the final open/fixed list in `production-readiness.md` before submitting.

### Architecture refactor (supporting, not a feature)

Phases 1 to 7 split the starter's `src/` into seven hexagonal verticals (`identity`, `knowledge`, `conversations`, `transfers`, `support`, `accounts`, `assistant`) with ESLint-enforced layers (`1e6c507` closes Phase 7). Behaviour was preserved by characterisation tests written green on the old code first. Plan and record: [`architecture-decoupling.md`](architecture-decoupling.md).

## Part 2 - "The agent never states a fact it cannot prove"

Full design, decisions and demo script: [`part2-design.md`](part2-design.md). Two pieces share one rule: facts come from code that checks the bank, not from the model.

- **B. Transfer pre-flight checks (customer).** Each transfer proposal carries code-computed checks: balance after the transfer (a blocker when short), first-time recipient, unusual amount, and a pending twin. The agent relays them verbatim; the approval card shows them, blockers first.
- **A. Verified case brief (operator).** A fixed workflow turns a support case into a timeline, claims checked by an oracle (true, false, or unverifiable), findings with cited procedures, and an editable reply that closes the case and reaches the customer.

### Status

| #   | Commit                                                    | State                                                          |
| --- | --------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | `a8c5d8d` policy rules table, drift guard, fence          | Done                                                           |
| 2   | `df4cc7a` pre-flight checks on proposals                  | Done (hardened in `8b5769e`)                                   |
| 3   | `72409f1` pre-flight checks on the approval card          | Done; covered by e2e journey B                                 |
| 4   | Deterministic case brief                                  | **TODO** not on `main` at `f13e833`; confirm state and SHA     |
| 5   | Operator reply closes the case and reaches the customer   | **TODO** in progress                                           |
| 6   | Model-written brief (extraction, writing call, post-check) | **TODO** in progress                                           |
| 7   | Real-model eval (L5, `npm run eval:case-brief`)           | **TODO** in progress; `eval:case-brief` is not in `package.json` at `f13e833` |

**TODO (Pablo):** once 4 to 7 land, replace this table with SHAs and add the eval results (cases passed, model used, report path). No eval number is claimed here.

### How to try it

Pre-flight checks (available now): see scene 4 of [`video-script.md`](video-script.md). Case brief: **TODO** add the final steps once commits 4 to 6 are merged; the intended flow is design section 8.

## Run, test and verify

Requirements: Node 24 or newer, npm. Details and troubleshooting: [`../README.md`](../README.md).

```sh
npm ci
npm run setup      # creates .env.local, seeds empty databases
npm run dev        # app on http://127.0.0.1:3000, bank on :4001
```

| Check                | Command                                 | Notes                                                                                   |
| -------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Types                | `npm run typecheck`                     |                                                                                         |
| Lint and format      | `npm run lint` / `npm run format:check` | ESLint also enforces the layer rules                                                    |
| Unit + integration   | `npm test`                              | Real bank over HTTP, scripted fake model; never uses a real key                         |
| Browser journeys     | `npm run test:e2e`                      | Isolated stack: ports 3100/4101, fake model on 4102, `.e2e/data`                        |
| Git hooks            | automatic                               | `pre-commit`: lint, format:check, typecheck. `pre-push`: `npm test`, `npm run test:e2e` |
| Real-key smoke check | `npm run doctor`                        | Spends real model quota                                                                 |

**TODO (Pablo):** run `npm test` and `npm run test:e2e` on the final commit in a fresh unzip and record the counts. Last count seen in commit messages: 863 tests at `1e6c507`.

### Model provider

Set `MODEL_PROVIDER` in `.env.local`. `.env.example` pins `openai`.

| Value        | Behaviour                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `openai`     | Target configuration. Needs `OPENAI_API_KEY`; embeddings for semantic search                                                           |
| `claude-cli` | Chat through `claude -p --model haiku` (needs the Claude Code CLI, logged in). Search is lexical (SQLite FTS5); the UI shows "Score"   |
| `auto`       | OpenAI when a key is set; Claude CLI when the key is blank or OpenAI answers `429 insufficient_quota`, then skips OpenAI for 5 minutes |

`/api/health` reports `modelProvider`, `searchMode` and `lastFallbackAt`. Tests force `MODEL_PROVIDER=openai` and a blank key.

### Production mode

```sh
npm run build
npm start
```

`npm start` exits with status 1 unless `SESSION_SECRET`, `BANK_SERVICE_SECRET` and `BANK_ADMIN_SECRET` are three different random values of at least 32 characters (for example `openssl rand -hex 32` once per variable). `npm run build` does not need them. Source: `f13e833`, `src/platform/AGENTS.md`.

### Reset and bank scenarios

`npm run reset` (services stopped) wipes local activity; run `npm run ingest` afterwards. `npm run scenario -- normal | intermittent 17 | lost-response` switches the running bank's failure profile.

## What is finished and what is pending

Finished (traceable to commits above): the Part 1 fixes in the table; the architecture refactor; Part 2 piece B end to end (domain, persistence, agent prompt line, approval card, e2e).

Pending:

- Part 2 piece A, commits 4 to 7 (**TODO**, see status table).
- `ai-sessions/` exports, `demo.mp4` (**TODO**).
- Before/after evidence for the Part 1 headline fixes (**TODO**).
- Open readiness findings (P0-5, P0-6, P0-7 and others in `production-readiness.md`).
- Final fresh-unzip run of this README's commands (**TODO**).

Deliver one ZIP with the complete project and this folder. Exclude `.env*` except `.env.example`, `node_modules/`, `.next/` and `.git/`.
