<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# tests

## Purpose

Shared test infrastructure only. Test files themselves are **colocated** next to the source they test (`src/auth.ts` → `src/auth.test.ts`). Conventions live in `../TESTING.md`.

## Key Files

| File                            | Description                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup.ts`                      | Preloaded via `--import`: temp `DATA_DIR`/`BANK_DATA_DIR`, a free `BANK_PORT`/`BANK_URL`, no OpenAI key or base URL                                                         |
| `support/bank.ts`               | Starts the real simulator over HTTP; `resetBank`, `bankScenario`, `bankSnapshot`, `operationsFor`, `balanceOf` via admin API                                                |
| `support/network.ts`            | `startLossyBank(lose)`: proxy between app and bank that drops selected responses after the bank processed them (lost-after-commit), restoring `config.bankUrl` on `close()` |
| `support/api.ts`                | `api(method, path, { as, body, headers })`: calls the route handlers in-process with a signed session cookie                                                                |
| `support/openai.ts`             | Fake OpenAI server (Responses + Embeddings): `script(toolCall(...), reply(...))`, records every request                                                                     |
| `support/e2e.ts`                | Playwright aliases (`describe`/`it`/`expect`), `openAs`, admin `resetBank`/`bankSnapshot` for E2E                                                                           |
| `support/e2e-env.ts`            | Fixed ports, data dir, `.next-e2e` dist dir and admin secret of the E2E stack                                                                                               |
| `support/fake-openai-server.ts` | Standalone policy-driven fake model on port 4102 used by `playwright.config.ts`                                                                                             |

## For AI Agents

### Working In This Directory

- Do not put test cases here; put them beside the code under test. Only shared harness code (setup, bank process, OpenAI fake, E2E helpers) belongs here.
- `setup.ts` must run before any application module loads, because `src/config.ts` reads the environment at import time.

### Testing Requirements

- Follow `../TESTING.md`: `describe` per unit, `it('should …')` per case, `// Arrange` / `// Act` / `// Assert` in every body.
- `npm test` must stay green; `npm run typecheck` and `npm run format:check` too.

### Common Patterns

- Shared state reset (`seedBank()`, `setScenario('normal')`) in `beforeEach`; case-specific setup in `// Arrange`.
- Route handlers are called in-process with a `Request` and `{ params: Promise.resolve({ path: [...] }) }`; session cookie from `sessionToken('<userId>')`.

## Dependencies

### External

- `node:test`, `node:assert/strict`, `tsx`, `@playwright/test`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
