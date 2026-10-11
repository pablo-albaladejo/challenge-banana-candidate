<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# scripts

## Purpose

CLI entrypoints run with `node --import tsx` (no build step). They bootstrap, run, reset, and probe the app and the simulated bank.

## Key Files

| File          | npm script                                                                                         | Description and side effects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup.ts`    | `npm run setup`                                                                                    | Copies `.env.example` to `.env.local` if missing (never overwrites). Seeds app DB if no `seed` meta row, seeds bank if `accounts` empty. Non-destructive on existing data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `dev.ts`      | `npm run dev`; `npm start` (adds `--production`)                                                   | Writes `DATA_DIR/app-running.pid` (aborts if that PID is alive), spawns `simulator/server.ts` with `OPENAI_API_KEY` stripped from its env, polls `BANK_URL/health` (up to 60 x 250 ms), then spawns `next dev --webpack` (or `next start`) on `127.0.0.1:APP_PORT`. On exit or signal kills both children (SIGKILL after 5 s) and removes the pid file. `start` requires a prior `npm run build`                                                                                                                                                                                                                                                                                                                           |
| `reset.ts`    | `npm run reset`                                                                                    | **Destructive.** Refuses (exit 1) while the pid marker's process is alive; removes a stale marker. Then `seedBank()` + `seedApp()`: wipes bank ledger and app conversations/incidents/approvals, restores fixtures and portable index, scenario back to `intermittent` seed 17. Save evidence first                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `scenario.ts` | `npm run scenario -- <profile> [seed]`                                                             | `POST /admin/scenario` on the running bank with `Bearer BANK_ADMIN_SECRET`. Profile defaults to `normal`, seed to 17. Validates profile against `simulator/bank.ts#profiles`. Resets scenario counter, does not restore balances. Bank must be running                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ingest.ts`   | `npm run ingest` (`-- --export` also writes `fixtures/embeddings/index.json.gz`)                   | Runs `ingest()` from `src/knowledge` (the frozen legacy entry-point): re-indexes the document corpus. **Spends OpenAI embedding quota** and rewrites the app index. Run after ingestion changes and after a reset when needed. `--export` overwrites the shipped fixture index                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `doctor.ts`   | `npm run doctor`                                                                                   | One Responses call through the gateway (`config.chatModel`, max 100 output tokens, `store:false`), then, when OpenAI answered, one embedding call. Prints JSON with `provider` (`openai`, or `claude-cli` from `response.metadata.provider`, also after a quota fallback), `chatModel`, `reply`, `searchMode` (`semantic` + `dimensions`, or `lexical` + a note that Claude has no embeddings) and `keyConfigured`; on failure prints `{ok:false,provider,status,code,hint}` and exits 1. **Spends real API quota** (or the Claude subscription under claude-cli); no data changes                                                                                                                                         |
| `eval.ts`     | `npm run eval -- <suite.ts> [--aa \| --baseline a.json …] [--out f] [--n 3] [--timeout-ms 120000]` | Loads a suite module (default export `EvalSuite`, see `evals/AGENTS.md`), builds its subject over the model gateway (`MODEL_PROVIDER` respected), runs it with `evals/runner`, prints the table and writes the JSON report (`.eval-results/`, gitignored, unless `--out`). `--aa` records an A/A baseline candidate; `--baseline` takes ≥ 3 of them to arm the quality gates. Exit (`evals/exit-code.ts`) 0 pass or a complete A/A, 1 a failed gate or an unmeasured run, 2 a harness fault or any unexpected error, 3 ungated (no baseline, a too-noisy gate or a model mismatch). **Spends real quota** when the suite's subject calls the model; never run by the hooks. Spawned on the example suite by `eval.test.ts` |

## For AI Agents

### Working In This Directory

- Do not "fix" bank behavior from here: `scenario.ts` talks to the bank only through its admin API, and `dev.ts` deliberately hides the OpenAI key from the bank process. Keep both.
- `npm run reset` and the pid marker are the guard against corrupting live databases; do not bypass the check.
- Data locations come from `src/platform/config.ts` (`DATA_DIR`, `BANK_DATA_DIR`, default `.data/`); secrets default to local values (`banana-local-service`, `banana-local-admin`).
- Scripts import from `src/` and `simulator/` with extensionless paths; keep that style.

### Testing Requirements

- Only `eval.ts` has a colocated test (`eval.test.ts`, run by `npm test`, following `../TESTING.md`; it spawns the CLI on fake-subject suites, no model call). The others: verify by running: `npm run setup`, `npm run dev`, `npm run scenario -- lost-response` (second terminal), `npm run reset` (after stopping dev). `ingest` needs `OPENAI_API_KEY` in `.env.local`; `doctor` needs it unless the claude-cli provider is active (`MODEL_PROVIDER`).
- `npm run typecheck` covers these files.

### Common Patterns

- Top-level `await`, `try/catch` that prints a short message and sets `process.exitCode = 1` (no stack traces, no secrets).
- Process control via `child_process.spawn`, `process.kill(pid, 0)` liveness checks, SIGTERM then SIGKILL.

## Dependencies

### Internal

- `evals/*` (`eval.ts`), `src/platform/config`, `src/server/seed` (`seedApp`), `src/platform/db/db` (`appDb`), `src/knowledge` (`ingest`, `saveInitialIndex`), `src/knowledge/infrastructure/cached-openai-embedder` (`embedTexts`, `doctor`), `src/platform/model/gateway` (`doctor`), `simulator/seed`, `simulator/db`, `simulator/bank` (`profiles`)

### External

- `tsx`, `next` (spawned via `node_modules/next/dist/bin/next`), `openai` (via `src/platform/model/gateway`)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
