<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# tests

## Purpose

Shared test infrastructure only. Test files themselves are **colocated** next to the source they test (`src/auth.ts` → `src/auth.test.ts`). Conventions live in `../TESTING.md`.

## Key Files

| File                            | Description                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup.ts`                      | Preloaded via `--import`: temp `DATA_DIR`/`BANK_DATA_DIR`, a free `BANK_PORT`/`BANK_URL`, no OpenAI key or base URL; seeds Faker from `TEST_SEED`                                                                                                                                                                                                                         |
| `global-setup.ts`               | `--test-global-setup` of `npm test`: runs once in the node:test parent, picks a random `TEST_SEED` (unless set) that every test file inherits, prints it                                                                                                                                                                                                                  |
| `fixtures/world.ts`             | Typed constants of the seeded world (customers, operators, accounts, conversations, cases, historic transfer, unknown ids, counts, money limits)                                                                                                                                                                                                                          |
| `fixtures/factories.ts`         | Rosie + Faker factories: `toolContextFactory`, `transferInputFactory`, `intentFactory`/`persistIntent`/`storedIntent`/`intentRowOf`, `searchResultFactory`, `chunkFactory`, `documentRecordFactory`, `eventDataFactory`; repo inputs `conversationFactory`, `messageFactory`, `runFactory`, `approvalFactory`, `incidentFactory`, `eventFactory`                          |
| `fixtures/tool-definitions.ts`  | `goldenToolDefinitions`: the agent tool definitions as the model received them before the tool registry (raw data). Pinned byte for byte by `src/agent/tools/registry.test.ts` and `src/agent/loop.test.ts`                                                                                                                                                               |
| `support/db.ts`                 | App database readers for assertions: `intentRow`, `approvalsFor`, `runOf`, `latestRun`, `messagesOf`, `events`, `eventsFor`                                                                                                                                                                                                                                               |
| `support/bank.ts`               | Starts the real simulator over HTTP (waits for its own listening line, and moves to a fresh port if another file took the reserved one); `resetBank`, `bankScenario`, `bankSnapshot`, `operationsFor`, `balanceOf` via admin API                                                                                                                                          |
| `support/network.ts`            | `startLossyBank(lose, fault = 'drop')`: proxy between app and bank that spoils selected responses after the bank processed them: `drop` (lost-after-commit), `html-502` (gateway error page), `empty` (200, no body), `truncated` (body cut off mid-stream), `hang` (holds the request before the bank sees it until `release()`); restores `config.bankUrl` on `close()` |
| `support/api.ts`                | `api(method, path, { as, body, headers })`: calls the route handlers in-process with a signed session cookie                                                                                                                                                                                                                                                              |
| `support/openai.ts`             | Fake OpenAI server (Responses + Embeddings): `script(toolCall(...), reply(...))`, records every request                                                                                                                                                                                                                                                                   |
| `support/e2e.ts`                | Playwright aliases (`describe`/`it`/`expect`), `openAs`, admin `resetBank`/`bankSnapshot` for E2E                                                                                                                                                                                                                                                                         |
| `support/e2e-env.ts`            | Fixed ports, data dir, `.next-e2e` dist dir and admin secret of the E2E stack                                                                                                                                                                                                                                                                                             |
| `support/fake-openai-server.ts` | Standalone policy-driven fake model on port 4102 used by `playwright.config.ts`                                                                                                                                                                                                                                                                                           |

## For AI Agents

### Working In This Directory

- Do not put test cases here; put them beside the code under test. Only shared harness code (setup, bank process, OpenAI fake, E2E helpers) belongs here.
- `setup.ts` must run before any application module loads, because `src/config.ts` reads the environment at import time.
- The harness is an oracle, not a client of the code under test: `support/db.ts` and `persistIntent` keep their own raw SQL (named columns) and never call `src/persistence/*`.
- Test data: ids the bank or the app seed know come from `fixtures/world.ts`; objects a test builds come from `fixtures/factories.ts`; stored state is read with `support/db.ts`. No per-file builders.
- **Never fake bank ids.** The real bank validates customers, accounts and references; Faker only fills free values (amounts, concepts, texts, run/intent ids). Factory defaults must always be valid against the seeded bank (default amounts stay below `money.lowestBalanceCents`).
- Seed policy: each `npm test` run uses a new random seed, printed at start and end; `TEST_SEED=<n> npm test` replays it. A seed-dependent failure is fixed in the factory ranges, not in the test.
- Assertions compare against the object a factory built, never a literal Faker could change.
- `fixtures/` here is test data; the repo-root `fixtures/` is the RAG corpus and seed — never edit it for tests.

### Testing Requirements

- Follow `../TESTING.md`: `describe` per unit, `it('should …')` per case, `// Arrange` / `// Act` / `// Assert` in every body.
- `npm test` must stay green; `npm run typecheck` and `npm run format:check` too.

### Common Patterns

- Shared state reset (`seedBank()`, `setScenario('normal')`) in `beforeEach`; case-specific setup in `// Arrange`.
- Route handlers are called in-process with a `Request` and `{ params: Promise.resolve({ path: [...] }) }`; session cookie from `sessionToken('<userId>')`.

## Dependencies

### External

- `node:test`, `node:assert/strict`, `tsx`, `@playwright/test`, `rosie`, `@faker-js/faker`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
