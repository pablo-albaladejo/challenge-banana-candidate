<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-11 | Updated: 2026-10-11 -->

# evals

## Purpose

The generic L5 real-model eval harness (`submission/part2-design.md` §7.5): it runs each case N
times against an injected subject, counts per-assertion passes, gates them (or the suite's
metrics, when it declares any) with a policy derived from measured noise, and writes a console table and a JSON report. It knows nothing about case
briefs: the real five seeded cases and their subject arrive with commit 7. Custom on `node:test`
and `tsx`; evalite and promptfoo were rejected (§7.6).

## Key Files

| File              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `case.ts`         | `EvalCase` (id, `input()` builder, `must[]`/`mustNot[]` labelled boolean predicates, optional `n`), `Subject` (`(input, signal) => Promise<unknown>`), `EvalSuite` (a suite module's default export, with optional `metrics`), `Metric`/`CaseOutcome` (a metric: `(run: { caseId, output, kept }[]) => rate in [0, 1]`, `kept('kind: label')` an accessor that throws a `HarnessFault` for a key the case does not declare), `HarnessFault`, `validateCases` (non-function `input`/`check`, non-array lists, duplicates, bad `n` are faults)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `runner.ts`       | `runSuite(suite, { defaultN = 3, timeoutMs = 120000, now, baseline, aa, model })`: options validated (`defaultN` ≥ 1, `timeoutMs` > 0, no `baseline` with `aa`), sequential runs, per-run timeout with `AbortSignal`, unmeasured runs (`input`, `error`, `timeout`, `unparseable`); a throwing or non-boolean predicate, a malformed case or suite is a `HarnessFault`; quality gates are `ungated` (reason `model mismatch`) when the run's model differs from the baseline's; with `metrics` (a non-empty map of functions, every case at the same N) each metric is scored once per run index over all cases (0 when a case of that run is unmeasured) and gated per metric (`ungated` with reason `incomplete` when a run index has an unmeasured case, `case mismatch` when the baseline measured other cases), the metric records its sorted `caseIds`, metrics receive frozen outcomes (a deep-frozen structured clone of each output), and the `must` assertions become `diagnostic` |
| `thresholds.ts`   | `passRate`, `deriveThreshold` (A/A mean − max(2 sample SD, 1/n), null under 3 A/A runs), `gateQuality` (`ungated` without A/A rates, `too-noisy` when n < 3 or the margin ≥ the mean, else pass/fail), `gateMetric` (on the A/A per-run samples: mean − max(2 SE, 1/cases), SE = pooled per-run SD of all k × n samples / √n), `decide` (`mustNot` zero tolerance), `baselineFromReports` (≥ 3 complete, well-formed A/A reports of one suite on one model with identical `must` keys, metric names, n and metric case ids; rates finite in [0, 1]; a metric's samples must number n and its rate be their mean; `metrics` holds each metric's A/A rates, per-run samples and sorted case ids), `assertionKey`                                                                                                                                                                                                                                                                               |
| `report.ts`       | `EvalReport` types (per case × run × assertion with the gating reason, `metrics` with case ids, per-run samples, threshold and verdict when the suite declares them, `policy.casePassed` stating what a case's `passed` means, unmeasured counts, model/provider, latency, timestamps, policy, `aa`, `status`), `reportStatus`, `formatReport` (console table, metrics table, reasons and status line), `writeReport`, `readReport` (a baseline file; unreadable or not JSON is a `HarnessFault`), `defaultReportPath` (`.eval-results/<suite>-<startedAt>.json`, gitignored)                                                                                                                                                                                                                                                                                                                                                                                                                |
| `exit-code.ts`    | `exitCodeFor(report \| error)`: the CLI exit code from the report status, or 2 for any error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `model.ts`        | `gatewayModel()`: `createResponse` through `src/platform/model/gateway` (so `MODEL_PROVIDER` and the quota fallback apply) and `observed()` (the providers and models that answered, each call attributed by the gateway's `createAttributedResponse`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `example.eval.ts` | A sample suite with a trivial fake subject (no model call) and one metric (`greets by name`), showing the shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

The CLI is `scripts/eval.ts` (`npm run eval -- <suite.ts> [--aa | --baseline a.json --baseline b.json --baseline c.json] [--out file] [--n 3] [--timeout-ms 120000]`), tested by spawning it in `scripts/eval.test.ts`.

| Status       | When                                                                                    | Exit |
| ------------ | --------------------------------------------------------------------------------------- | ---- |
| `pass`       | complete, every gate (assertion or metric) armed and passed                             | 0    |
| `aa`         | `--aa`: complete and no `mustNot` failure; a baseline candidate, **not** a pass         | 0    |
| `fail`       | complete, a `mustNot`, a gated `must` or a gated metric failed                          | 1    |
| `incomplete` | any unmeasured run (checked first)                                                      | 1    |
| harness      | a `HarnessFault` (bad arguments, golden set, suite or baseline) or any unexpected error | 2    |
| `ungated`    | complete, no failure, but a `must` or metric is `ungated` or `too-noisy`                | 3    |

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
- A suite without `metrics` is gated per assertion. A suite that declares `metrics` (extraction
  recall/precision, verdict accuracy, `must` coverage, …, §7.5) is gated **per metric**: each
  metric is called once per run index with every case's `{ caseId, output, kept }` and returns a
  rate in [0, 1]; its rate is the mean of those per-run samples, gated at the A/A mean −
  max(2 SE, 1/cases) (see Metric noise) with the same `ungated`/`too-noisy`/model and n mismatch rules. The
  `must` rates are then `diagnostic` (reported, never gated); `mustNot` stays zero tolerance per
  assertion. Every case must run the same N. A run index with an unmeasured case scores 0 on every
  metric, the metric is `ungated` (reason `incomplete`) rather than failed, and the report is
  incomplete (exit 1). A metric that throws or returns anything but a finite number in [0, 1], an
  empty `metrics`, or a non-function is a harness fault.
- **Metric noise.** A metric's margin is max(2 SE, 1/cases) where SE, the noise of one report
  mean, is the pooled sample SD of every A/A per-run sample (k reports × n runs, Bessel) over √n.
  It treats runs as independent draws, so A/A reports whose means happen to agree still yield the
  run-to-run noise. A/A metrics whose samples do not number n, or whose rate is not their mean,
  are a harness fault. Per-assertion gating keeps the A/A rate SD. The threshold ignores the
  uncertainty of the A/A mean itself (the SE of a new report against the A/A mean is
  SE·√(1 + 1/k)), so it is slightly liberal.
- **Metric case set.** Each metric records the sorted ids of the cases it measured; A/A reports
  over different case sets are a harness fault, and a run over another set than the baseline's
  (swapped or grown) is `ungated` with reason `case mismatch`.
- **Known blind spot of the 1/cases floor (accepted).** With the floor at one case, a single
  golden case can fail on every run and the metric still passes when the A/A was clean (5 cases:
  a 20% blind spot). It was accepted because a tighter floor would gate on less than one case of
  signal, which the A/A noise of a 5-case set cannot support; the per-case safety net remains
  `mustNot`, zero tolerance on every run of every case, and the `must` diagnostics still show
  which case regressed.
- A one-case metric suite is always `too-noisy` (the 1/cases floor is the whole range), so it is
  never gated.
- **Metrics must not mutate** what they receive. The run array, each outcome and a deep-frozen
  structured clone of each output are frozen (so a metric suite's parsed output must be plain,
  cloneable data); a mutation throws and is a harness fault. `kept` is an accessor: a key the case
  does not declare (a typo) is a harness fault, never a silent `undefined`. Only plain data is
  supported: the contents of a `Map` or `Set` are not frozen, and class prototypes are lost by the
  clone, so neither is protected.
- In a suite with metrics a case's `passed` only means every run was measured and every
  `mustNot` kept; its quality is in the metrics. `policy.casePassed` in the JSON says which reading
  applies.
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
