// The gate policy (design §7.5, hub note "Gates on stochastic model output: thresholds from
// measured noise"). `mustNot` is safety: zero tolerance on every run, never relaxed. `must` is
// quality: gated k-of-n at the A/A mean minus max(2 sample SD, one run), and only reported
// (`ungated`) until at least three A/A runs exist. A gate that could never fail (a margin that
// swallows the mean, or fewer than three runs) is `too-noisy`, never a pass. A pass rate counts
// unmeasured runs as failures. A suite that declares metrics is gated per metric instead, with a
// floor of one case (1/cases) rather than one run; its `must` rates are then diagnostics. A
// metric's noise is the standard error of a report mean, from the per-run samples (see metricNoise).
import { z } from 'zod';
import { HarnessFault, type AssertionKind } from './case';
import type { EvalReport, ModelInfo } from './report';

/** `diagnostic`: a `must` rate of a suite gated by its metrics, reported but never gated. */
export type Verdict = 'pass' | 'fail' | 'ungated' | 'too-noisy' | 'diagnostic';
/**
 * The A/A pass rates per assertion key (same commit, same model), the suite and model they came
 * from, and the run count `ns` each key was measured with (a gate is only valid at that n).
 */
export type Baseline = {
  suite: string;
  model: ModelInfo;
  rates: Record<string, number[]>;
  ns: Record<string, number>;
  /**
   * Per metric name: each A/A report's rate, its per-run samples, the runs it was measured on and
   * the sorted ids of the cases it was measured over (a run over another set is not gated).
   */
  metrics?: Record<string, { rates: number[]; samples: number[][]; n: number; caseIds: string[] }>;
};
export type QualityGate = { threshold: number | null; verdict: Verdict; reason?: string };
export const minAaRuns = 3;
/** Under three runs one run moves the rate by half or more: such a gate is never armed. */
export const minGatedN = 3;
/** Float slack, so a rate equal to its threshold (2/3 vs 1 − 1/3) is not read as below it. */
const epsilon = 1e-9;

export const passRate = (passes: number, runs: number) => passes / runs;
export const assertionKey = (caseId: string, kind: AssertionKind, label: string) =>
  `${caseId} :: ${kind} :: ${label}`;
/** Same providers and models, whatever the order they answered in. */
export const sameModel = (a: ModelInfo, b: ModelInfo) =>
  JSON.stringify([[...a.providers].sort(), [...a.models].sort()]) ===
  JSON.stringify([[...b.providers].sort(), [...b.models].sort()]);
const percent = (rate: number) => `${Math.round(rate * 100)}%`;

/** The A/A mean and the margin below it: max(2 sample SD, `floor`: one run, or one case). */
function noise(aaRates: number[], floor: number) {
  const mean = aaRates.reduce((s, r) => s + r, 0) / aaRates.length;
  const variance = aaRates.reduce((s, r) => s + (r - mean) ** 2, 0) / (aaRates.length - 1);
  return { mean, margin: Math.max(2 * Math.sqrt(variance), floor) };
}

/**
 * The A/A mean of a metric and the margin below it: max(2 SE, `floor`). The SE of a report mean
 * is the pooled per-run SD over every A/A sample (k reports × n runs, Bessel) divided by √n: the
 * runs are the measured noise, so A/A reports whose means happen to agree still yield a margin.
 */
function metricNoise(aaSamples: number[][], floor: number) {
  const all = aaSamples.flat();
  const n = all.length / aaSamples.length;
  const mean = all.reduce((s, x) => s + x, 0) / all.length;
  const variance = all.reduce((s, x) => s + (x - mean) ** 2, 0) / (all.length - 1);
  return { mean, margin: Math.max((2 * Math.sqrt(variance)) / Math.sqrt(n), floor) };
}

/** The quality threshold for an assertion run `n` times, or null while the A/A is too short. */
export function deriveThreshold(aaRates: number[], n: number): number | null {
  if (aaRates.length < minAaRuns) return null;
  const { mean, margin } = noise(aaRates, 1 / n);
  return Math.max(0, mean - margin);
}

export function decide(kind: AssertionKind, rate: number, threshold: number | null): Verdict {
  if (kind === 'mustNot') return rate >= 1 - epsilon ? 'pass' : 'fail';
  if (threshold === null) return 'ungated';
  return rate + epsilon >= threshold ? 'pass' : 'fail';
}

/** Gates a `must` rate on its A/A rates; refuses to arm a gate that could never fail. */
export function gateQuality(rate: number, aaRates: number[] | undefined, n: number): QualityGate {
  return gate(
    rate,
    n,
    'assertion',
    aaRates && aaRates.length >= minAaRuns && noise(aaRates, 1 / n),
  );
}

/**
 * Gates a metric rate (the mean of its per-run samples over `n` runs of `cases` cases) on the
 * per-run samples of its A/A reports, at the mean minus max(2 SE of a report mean, one case).
 */
export function gateMetric(
  rate: number,
  aaSamples: number[][] | undefined,
  n: number,
  cases: number,
): QualityGate {
  return gate(
    rate,
    n,
    'metric',
    aaSamples && aaSamples.length >= minAaRuns && metricNoise(aaSamples, 1 / cases),
  );
}

function gate(
  rate: number,
  n: number,
  what: 'assertion' | 'metric',
  aa: { mean: number; margin: number } | false | undefined,
): QualityGate {
  if (!aa)
    return { threshold: null, verdict: 'ungated', reason: `no A/A baseline for this ${what}` };
  if (n < minGatedN)
    return {
      threshold: null,
      verdict: 'too-noisy',
      reason: `n = ${n} is under ${minGatedN}, one run swings the rate too far: raise N to gate it`,
    };
  const { mean, margin } = aa;
  if (mean - margin <= epsilon)
    return {
      threshold: 0,
      verdict: 'too-noisy',
      reason: `vacuous threshold: margin ${percent(margin)} >= A/A mean ${percent(mean)}; raise N or add A/A runs`,
    };
  const threshold = mean - margin;
  return { threshold, verdict: decide('must', rate, threshold) };
}

/** The part of a report a baseline reads; anything else in an A/A file is ignored. */
const aaShape = z.object({
  suite: z.string(),
  aa: z.literal(true),
  startedAt: z.string(),
  complete: z.boolean(),
  model: z.object({ providers: z.array(z.string()), models: z.array(z.string()) }),
  cases: z.array(
    z.object({
      id: z.string(),
      assertions: z.array(
        z.object({
          kind: z.enum(['must', 'mustNot']),
          label: z.string(),
          n: z.number().int().min(1),
          rate: z.number().min(0).max(1),
        }),
      ),
    }),
  ),
  metrics: z
    .array(
      z
        .object({
          name: z.string(),
          n: z.number().int().min(1),
          caseIds: z.array(z.string()).min(1),
          rate: z.number().min(0).max(1),
          samples: z.array(z.number().min(0).max(1)),
        })
        .refine((m) => m.samples.length === m.n, {
          message: 'a metric must hold one sample per run',
        })
        .refine((m) => Math.abs(m.rate - m.samples.reduce((s, x) => s + x, 0) / m.n) <= epsilon, {
          message: 'a metric rate must be the mean of its samples',
        }),
    )
    .optional(),
});

/**
 * Builds the baseline from at least three complete A/A reports of one suite on one model, all
 * with the same `must` assertions and metrics run the same number of times, each a distinct run (a
 * file given twice is not three runs). Anything else is a harness fault.
 */
export function baselineFromReports(reports: EvalReport[]): Baseline {
  if (reports.length < minAaRuns)
    throw new HarnessFault(`A baseline needs at least ${minAaRuns} A/A reports.`);
  const checked = reports.map((r, i) => {
    const parsed = aaShape.safeParse(r);
    if (!parsed.success)
      throw new HarnessFault(
        `A/A report ${i + 1} is malformed: ${parsed.error.issues[0].message}.`,
      );
    return parsed.data;
  });
  const [first] = checked;
  const runsOf = (r: (typeof checked)[number]) =>
    JSON.stringify(
      r.cases
        .flatMap((c) =>
          c.assertions
            .filter((a) => a.kind === 'must')
            .map((a) => `${assertionKey(c.id, a.kind, a.label)} × ${a.n}`),
        )
        .sort(),
    );
  const metricsOf = (r: (typeof checked)[number]) =>
    JSON.stringify((r.metrics ?? []).map((m) => `${m.name} × ${m.n}`).sort());
  const metricCasesOf = (r: (typeof checked)[number]) =>
    JSON.stringify(
      (r.metrics ?? []).map((m) => `${m.name}: ${JSON.stringify([...m.caseIds].sort())}`).sort(),
    );
  for (const r of checked) {
    if (!r.complete) throw new HarnessFault(`A/A report of ${r.startedAt} is incomplete.`);
    if (r.suite !== first.suite) throw new HarnessFault('A/A reports come from different suites.');
    if (!sameModel(r.model, first.model))
      throw new HarnessFault('A/A reports come from different model providers or models.');
    if (runsOf(r) !== runsOf(first))
      throw new HarnessFault('A/A reports differ in their assertions or run counts.');
    if (metricsOf(r) !== metricsOf(first))
      throw new HarnessFault('A/A reports differ in their metrics or run counts.');
    if (metricCasesOf(r) !== metricCasesOf(first))
      throw new HarnessFault('A/A reports measured their metrics over different cases.');
  }
  if (new Set(checked.map((r) => r.startedAt)).size !== checked.length)
    throw new HarnessFault('A/A reports repeat the same run (same startedAt): give distinct runs.');
  const rates: Baseline['rates'] = {};
  const ns: Baseline['ns'] = {};
  for (const r of checked)
    for (const c of r.cases)
      for (const a of c.assertions)
        if (a.kind === 'must') {
          const key = assertionKey(c.id, a.kind, a.label);
          (rates[key] ??= []).push(a.rate);
          ns[key] = a.n;
        }
  if (!first.metrics?.length) return { suite: first.suite, model: first.model, rates, ns };
  const metrics: NonNullable<Baseline['metrics']> = {};
  for (const r of checked)
    for (const m of r.metrics ?? []) {
      const entry = (metrics[m.name] ??= {
        rates: [],
        samples: [],
        n: m.n,
        caseIds: [...m.caseIds].sort(),
      });
      entry.rates.push(m.rate);
      entry.samples.push(m.samples);
    }
  return { suite: first.suite, model: first.model, rates, ns, metrics };
}
