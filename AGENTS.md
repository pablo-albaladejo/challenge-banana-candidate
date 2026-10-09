<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# challenge-banana-candidate

## Purpose

Banana Bank technical challenge starter: a fictional bank's AI assistant built on Next.js 16 + the OpenAI Responses API, backed by an external bank simulator and a SQLite-based document index. The task (see `docs/challenge.md`) is to (1) assess and improve readiness for a Monday launch and (2) design and ship a differentiating improvement to the agent or its agentic workflow. The starter intentionally contains behavior worth investigating — passing `npm test` does not mean it is customer-ready.

## Key Files

| File               | Description                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`     | Scripts (`setup`, `dev`, `reset`, `ingest`, `scenario`, `doctor`, `typecheck`, `test`, `format`, `format:check`, `lint`, `test:e2e`, `build`, `start`) and pinned deps |
| `README.md`        | Quick start, commands, project map, troubleshooting                                                                                                                    |
| `.env.example`     | Env template: OpenAI key/models, ports, `BANK_URL`, service/admin/session secrets                                                                                      |
| `next.config.ts`   | Marks `better-sqlite3` as a server external package; disables `X-Powered-By`                                                                                           |
| `tsconfig.json`    | TypeScript configuration                                                                                                                                               |
| `.nvmrc`           | Node 24 (minimum `>=24.0.0`)                                                                                                                                           |
| `.prettierrc.json` | Prettier formatting rules                                                                                                                                              |
| `TESTING.md`       | Testing conventions (colocation, describe/it, AAA, TDD) — mandatory for every test                                                                                     |
| `CLAUDE.md`        | Imports this file                                                                                                                                                      |

## Subdirectories

| Directory     | Purpose                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `app/`        | Next.js web UI and catch-all API route (see `app/AGENTS.md`)                                            |
| `src/`        | Application core: agent, banking integration, retrieval, ingestion, operator view (see `src/AGENTS.md`) |
| `simulator/`  | External bank simulator and ledger — a test dependency, not the product (see `simulator/AGENTS.md`)     |
| `scripts/`    | CLI entrypoints for setup, dev, reset, ingest, scenarios, doctor (see `scripts/AGENTS.md`)              |
| `tests/`      | Shared test harness only; tests are colocated with source (see `tests/AGENTS.md`)                       |
| `fixtures/`   | Document corpus, seed conversations, portable embedding index (see `fixtures/AGENTS.md`)                |
| `docs/`       | Challenge brief and bank API contract (see `docs/AGENTS.md`)                                            |
| `submission/` | Candidate submission materials (see `submission/AGENTS.md`)                                             |

## For AI Agents

### Working In This Directory

- Read `docs/challenge.md` and `docs/contracts.md` before changing behavior.
- **Do not "fix" problems by changing `simulator/`.** It stands in for an external bank; evaluation may swap it for an independent implementation of the same contract. Its failure scenarios (`intermittent`, `lost-response`, …) are part of the environment the app must handle.
- Preserve the observable bank contract or provide an equivalent adapter.
- Two SQLite databases live in `.data/` (app and bank, overridable via `DATA_DIR` / `BANK_DATA_DIR`). `npm run reset` wipes local activity and refuses to run while services are up — save evidence first.
- The document reference date for the exercise is **24 September 2026**, not the wall clock.
- Never commit `.env.local` or the OpenAI key; it is server-only.
- `npm run doctor`, chat, and semantic search spend real OpenAI quota.

### Testing Requirements

- **All tests follow `TESTING.md` — read it before writing or touching any test.** In short: the test file sits next to the file it tests (`x.ts` → `x.test.ts`); `describe` per module/function; one `it('should <positive functional outcome>')` per case; every body split by `// Arrange`, `// Act`, `// Assert` (`// Act & Assert` for `assert.throws`/`rejects`); no `skip`/`only`/`todo`. TDD: failing test first, confirm it fails for the right reason, then fix.
- `npm run typecheck` (runs `next typegen` first) and `npm test` (node:test over every colocated `*.test.ts` in `app/`, `src/`, `simulator/`, with `tests/setup.ts` preloaded).
- `npm run test:e2e`: Playwright journeys in `app/page.e2e.ts` against an isolated stack (`playwright.config.ts`: ports 3100/4101, fake model on 4102, `.e2e/data`, and `NEXT_DIST_DIR=.next-e2e` because Next 16 locks one dev server per output dir).
- `npm run format:check` must pass; `npm run format` applies Prettier (`.prettierignore` skips `fixtures/`, `docs/`, `README.md`). `npm run lint` runs ESLint (`eslint.config.mjs`: Next core-web-vitals + TypeScript; `any` warns in source, allowed in tests; `simulator/` ignored). No CI; Husky hooks are the gate: `pre-commit` runs `lint` + `format:check` + `typecheck`, `pre-push` runs `npm test` + `npm run test:e2e`. Do not bypass them with `--no-verify`.
- Add checks that support your improvements; public tests are not a readiness certificate.
- Reproduce bank failures with `npm run scenario -- normal | intermittent 17 | lost-response` while the bank runs.
- After ingestion changes run `npm run ingest`; after a reset, ingest again.

### Common Patterns

- ESM TypeScript run via `node --import tsx` (no compile step for scripts/simulator/tests).
- Agent tools are server functions calling the bank HTTP API — no MCP.
- `zod` for validation, `better-sqlite3` for storage, `openai` SDK for chat + embeddings.

## Dependencies

### External

- `next` 16.3.6 / `react` 19.3.0 — web app (webpack build)
- `openai` 7.23.0 — Responses API (`gpt-6-luna`) and embeddings (`text-embedding-3-small`, 1536 dims)
- `better-sqlite3` 13.0.3 — local storage
- `zod` 4.3.6 — schemas
- `tsx` — TypeScript execution for scripts, simulator, tests

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
