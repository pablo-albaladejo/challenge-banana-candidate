<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# tests

## Purpose

Public invariant tests for the bank ledger, seed reproducibility, session identity, corpus, and missing-key behavior. Passing them is **not** a readiness certificate; they do not exercise the agent, approvals, or retry logic.

## Key Files

| File                 | Description                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `invariants.test.ts` | Single `node:test` file (13 tests, below). Imports the simulator and app modules directly; no HTTP server or network needed |

Invariants covered, in order:

1. Reset reproduces identical accounts/movements/operations; each account balance equals the sum of its movements.
2. A transfer debits and credits without changing total money.
3. Idempotency by actor + reference: replay returns same id with `replay:true`, ledger unchanged; changed payload throws `different operation`.
4. Same payload under different references makes separate transfers.
5. Foreign account (`not authorized`), insufficient funds, and operator transfer (`account holder`) leave the ledger unchanged.
6. Amounts -1, 0, 0.5, Infinity, 10000001 and same-account destination are rejected without changes.
7. `reject-before` moves no money.
8. `lost-response` commits once, is queryable by its owner only, and a retry is a replay.
9. `intermittent` seed 17 yields the same 8-fault sequence twice and includes `lost-response`.
10. `seedApp()` is reproducible: 47 conversations, 17 incidents (8 closed), no empty conversations, >300 chunks with 1536-dim vectors, identical after reseeding.
11. Signed `banana_actor` cookie determines the actor; forged cookie / `x-user-id` header / missing cookie throw; `sameOrigin` rejects foreign origins.
12. Corpus: 80 unique documents, some internal, some with `validTo`, each original text >1000 chars.
13. `POST /api/search` with a blank `OPENAI_API_KEY` returns 503 `missing_openai_api_key` mentioning `OPENAI_API_KEY` and `restart`.

## For AI Agents

### Working In This Directory

- Do not weaken assertions or edit simulator scenarios to make a test pass. Fix the app.
- Counts such as 47 / 17 / 80 / 300 are tied to `fixtures/`; changing fixtures requires updating them deliberately.

### Testing Requirements

- Run: `npm test` (`node --import tsx --test tests/invariants.test.ts`). Node >= 24.
- Needs no running services and no OpenAI key. It sets `DATA_DIR` and `BANK_DATA_DIR` to a fresh `os.tmpdir()` directory **before** dynamically importing modules (so `src/config` picks them up), and removes it in `after()`. Never touch `.data/`.
- Needs `fixtures/` (docs corpus, seed conversations, `embeddings/index.json.gz`) present.
- `package.json` lists only this file; a new test file must be added to the `test` script.

### Common Patterns

- Dynamic `await import(...)` after setting env; close DBs in `after()` (`closeAppDb`, `closeBankDb`).
- Each bank test starts with `seedBank(); setScenario('normal'|...)`, captures `snapshot()` (accounts, movements, operations), acts, then `assert.deepEqual(snapshot(), before)` for no-effect cases.
- Call functions directly (`transfer('lucia', ref, input)`) and use `assert.throws(fn, /message regex/)` against `HttpError` messages. Route handlers are called with a constructed `Request` and `{ params: Promise.resolve({ path: [...] }) }`; session cookie from `sessionToken('lucia')`.
- To add a test: append `test('invariant stated as a sentence', () => {...})`, reuse the shared `input` fixture (lucia -> bruno, 1000 cents) and `snapshot()`, restore any mutated `process.env` in `finally`.

## Dependencies

### Internal

- `simulator/{seed,db,bank}`, `src/{seed,db,auth}`, `src/ingestion/pipeline`, `src/retrieval/store`, `app/api/[...path]/route`

### External

- `node:test`, `node:assert/strict`, `tsx`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
