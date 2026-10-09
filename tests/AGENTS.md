<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# tests

## Purpose

Shared test infrastructure only. Test files themselves are **colocated** next to the source they test (`src/auth.ts` → `src/auth.test.ts`). Conventions live in `../TESTING.md`.

## Key Files

| File       | Description                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup.ts` | Preloaded via `--import` into every test process: fresh temp `DATA_DIR`/`BANK_DATA_DIR` removed on exit, and `OPENAI_API_KEY=''` so no real key leaks in |

## For AI Agents

### Working In This Directory

- Do not put test cases here; put them beside the code under test. Only shared harness code (setup, future fakes such as a bank process or an OpenAI stub) belongs here.
- `setup.ts` must run before any application module loads, because `src/config.ts` reads the environment at import time.

### Testing Requirements

- Follow `../TESTING.md`: `describe` per unit, `it('should …')` per case, `// Arrange` / `// Act` / `// Assert` in every body.
- `npm test` must stay green; `npm run typecheck` and `npm run format:check` too.

### Common Patterns

- Shared state reset (`seedBank()`, `setScenario('normal')`) in `beforeEach`; case-specific setup in `// Arrange`.
- Route handlers are called in-process with a `Request` and `{ params: Promise.resolve({ path: [...] }) }`; session cookie from `sessionToken('<userId>')`.

## Dependencies

### External

- `node:test`, `node:assert/strict`, `tsx`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
