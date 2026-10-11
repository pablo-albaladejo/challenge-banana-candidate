<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-11 | Updated: 2026-10-11 -->

# evals

## Purpose

The generic L5 real-model eval harness (`submission/part2-design.md` §7.5): it runs each case N
times against an injected subject, counts per-assertion passes, gates them with a policy derived
from measured noise, and writes a console table and a JSON report. It knows nothing about case
briefs: the real five seeded cases and their subject arrive with commit 7. Custom on `node:test`
and `tsx`; evalite and promptfoo were rejected (§7.6).

## Key Files

| File              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `case.ts`         | `EvalCase` (id, `input()` builder, `must[]`/`mustNot[]` labelled boolean predicates, optional `n`), `Subject` (`(input, signal) => Promise<unknown>`), `EvalSuite` (a suite module's default export), `HarnessFault`, `validateCases` (non-function `input`/`check`, non-array lists, duplicates, bad `n` are faults)                                                                                                                                                          |
| `runner.ts`       | `runSuite(suite, { defaultN = 3, timeoutMs = 120000, now, baseline, aa, model })`: options validated (`defaultN` ≥ 1, `timeoutMs` > 0, no `baseline` with `aa`), sequential runs, per-run timeout with `AbortSignal`, unmeasured runs (`input`, `error`, `timeout`, `unparseable`); a throwing or non-boolean predicate, a malformed case or suite is a `HarnessFault`; quality gates are `ungated` (reason `model mismatch`) when the run's model differs from the baseline's |
| `thresholds.ts`   | `passRate`, `deriveThreshold` (A/A mean − max(2 sample SD, 1/n), null under 3 A/A runs), `gateQuality` (`ungated` without A/A rates, `too-noisy` when n < 3 or the margin ≥ the mean, else pass/fail), `decide` (`mustNot` zero tolerance), `baselineFromReports` (≥ 3 complete, well-formed A/A reports of one suite on one model with identical `must` keys and n; rates finite in [0, 1]), `assertionKey`                                                                   |
| `report.ts`       | `EvalReport` types (per case × run × assertion with the gating reason, unmeasured counts, model/provider, latency, timestamps, policy, `aa`, `status`), `reportStatus`, `formatReport` (console table, reasons and status line), `writeReport`, `readReport` (a baseline file; unreadable or not JSON is a `HarnessFault`), `defaultReportPath` (`.eval-results/<suite>-<startedAt>.json`, gitignored)                                                                         |
| `exit-code.ts`    | `exitCodeFor(report \| error)`: the CLI exit code from the report status, or 2 for any error                                                                                                                                                                                                                                                                                                                                                                                   |
| `model.ts`        | `gatewayModel()`: `createResponse` through `src/platform/model/gateway` (so `MODEL_PROVIDER` and the quota fallback apply) and `observed()` (the providers and models that answered, each call attributed by the gateway's `createAttributedResponse`)                                                                                                                                                                                                                         |
| `example.eval.ts` | A sample suite with a trivial fake subject (no model call), showing the shape                                                                                                                                                                                                                                                                                                                                                                                                  |

The CLI is `scripts/eval.ts` (`npm run eval -- <suite.ts> [--aa | --baseline a.json --baseline b.json --baseline c.json] [--out file] [--n 3] [--timeout-ms 120000]`), tested by spawning it in `scripts/eval.test.ts`.

| Status       | When                                                                                    | Exit |
| ------------ | --------------------------------------------------------------------------------------- | ---- |
| `pass`       | complete, every assertion gated and passed                                              | 0    |
| `aa`         | `--aa`: complete and no `mustNot` failure; a baseline candidate, **not** a pass         | 0    |
| `fail`       | complete, a `mustNot` or a gated `must` failed                                          | 1    |
| `incomplete` | any unmeasured run (checked first)                                                      | 1    |
| harness      | a `HarnessFault` (bad arguments, golden set, suite or baseline) or any unexpected error | 2    |
| `ungated`    | complete, no failure, but a `must` is `ungated` or `too-noisy`: nothing proved it       | 3    |

## For AI Agents

### Working In This Directory

- **Unmeasured never counts as a pass.** A run whose input cannot be built, whose subject throws or
  times out, or whose output does not parse adds zero passes to every assertion, is listed with its
  reason, and marks the report incomplete (non-zero exit). Do not add a path that skips such a run.
- `mustNot` predicates state the **forbidden** thing (true = violation). Safety is zero tolerance on
  every run and is never derived from a baseline.
- `must` thresholds come only from ≥ 3 complete A/A reports (`--aa`) on the same suite and model
  (`--baseline`); never hard-code a percentage. Without a baseline, quality is reported `ungated`
  and the eval exits 3, never 0. A key missing from the baseline, a run on another model (order of providers
  ignored) or a key run a different number of times than the baseline (`n mismatch`) is `ungated`
  too. A baseline of another suite is a harness fault, as is one built from the same A/A report
  twice (same `startedAt`, or the same `--baseline` path) or from a report that is not `aa`. A gate that cannot fail (n < 3, or a margin of 2 SD or one run that reaches the
  mean) is `too-noisy`: raise N or add A/A runs. The SD is the sample (Bessel) SD.
- A malformed golden set or baseline, a predicate that throws or returns a non-boolean, or any
  unexpected error is a harness fault (exit 2), never a model failure.
- Subjects **must honour `signal`**. On a timeout the runner moves on; a subject that ignores the
  signal keeps running, and any model call it makes later is still recorded by `observed()` (the
  wrapper cannot tell it from a measured call).
- Gating is per assertion for now. Commit 7 adds a suite-declared `metrics` hook (extraction
  recall/precision, verdict accuracy, …, §7.5) gated per metric with a floor of one case
  (1/cases) instead of one run; the per-assertion rates then become diagnostics.
- Real suites make real model calls: never import a suite with a real subject from a `*.test.ts`.

### Testing Requirements

- Colocated `*.test.ts`, run by `npm test` (`evals/**/*.test.ts`), following `../TESTING.md`. They
  use scripted fake subjects and the fake OpenAI of `tests/support/openai.ts`; no real calls.
- `npm run eval` is **not** part of `npm test` or the hooks.

### Common Patterns

- Inject everything nondeterministic: the subject, the parser, the clock (`now`), the baseline.

## Dependencies

### Internal

- `src/platform/model/gateway` (`model.ts`), `src/platform/config` (loaded by `scripts/eval.ts` for `.env.local`)

### External

- `openai` (types only), `node:test`, `tsx`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
