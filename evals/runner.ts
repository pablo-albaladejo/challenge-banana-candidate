// Runs each case N times against an injected subject and scores it with the threshold policy.
// The runner knows nothing about briefs: the subject, the parser and the cases are passed in.
import {
  HarnessFault,
  validateCases,
  type CaseOutcome,
  type EvalCase,
  type Metric,
  type Subject,
} from './case';
import {
  reportStatus,
  type AssertionResult,
  type CaseResult,
  type EvalReport,
  type MetricResult,
  type ModelInfo,
  type RunResult,
  type UnmeasuredReason,
} from './report';
import {
  assertionKey,
  decide,
  gateMetric,
  gateQuality,
  passRate,
  sameModel,
  type Baseline,
  type QualityGate,
} from './thresholds';

export type RunnableSuite<I, O> = {
  name: string;
  cases: EvalCase<I, O>[];
  subject: Subject<I>;
  parse: (raw: unknown) => O;
  /** Quality gated per metric (see `Metric`); the `must` rates are then diagnostics. */
  metrics?: Record<string, Metric<O>>;
};
export type RunOptions = {
  /** Runs per case unless the case sets `n` (design §7.5: N = 3). */
  defaultN?: number;
  /** A run past this is aborted and unmeasured. Defaults to the claude-cli timeout. */
  timeoutMs?: number;
  now?: () => number;
  /** A/A pass rates per assertion key; without one, quality assertions are reported ungated. */
  baseline?: Baseline;
  /** An A/A baseline-candidate run (`--aa`): no baseline allowed, reported as `aa`, not a pass. */
  aa?: boolean;
  /** The provider and model the subject used, read once the runs are over. */
  model?: () => ModelInfo;
};

class Unmeasured extends Error {
  constructor(
    readonly reason: UnmeasuredReason,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/** Each step's throw becomes the unmeasured reason of the run. */
async function step<T>(reason: UnmeasuredReason, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Unmeasured(reason, e);
  }
}

function withTimeout<I>(subject: Subject<I>, input: I, timeoutMs: number) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Unmeasured('timeout', new Error(`no output within ${timeoutMs} ms`)));
    }, timeoutMs);
  });
  return Promise.race([step('error', () => subject(input, controller.signal)), timeout]).finally(
    () => clearTimeout(timer),
  );
}

export async function runSuite<I, O>(
  suite: RunnableSuite<I, O>,
  options: RunOptions = {},
): Promise<EvalReport> {
  const { defaultN = 3, timeoutMs = 120_000, now = Date.now, baseline, aa = false } = options;
  if (!Number.isInteger(defaultN) || defaultN < 1)
    throw new HarnessFault('The default N must be a positive integer.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new HarnessFault('The run timeout must be a positive number of milliseconds.');
  if (aa && baseline)
    throw new HarnessFault('An A/A run records a baseline candidate; it cannot take a baseline.');
  if (baseline && baseline.suite !== suite.name)
    throw new HarnessFault(
      `The baseline is of suite "${baseline.suite}", this run is of suite "${suite.name}".`,
    );
  if (typeof suite.subject !== 'function')
    throw new HarnessFault(`Suite "${suite.name}": subject must be a function.`);
  if (typeof suite.parse !== 'function')
    throw new HarnessFault(`Suite "${suite.name}": parse must be a function.`);
  validateCases(suite.cases);
  const metrics = suite.metrics === undefined ? undefined : validMetrics(suite, defaultN);
  const startedAt = new Date(now()).toISOString();
  const measuredCases = [];
  for (const c of suite.cases) {
    const n = c.n ?? defaultN;
    const checks = [
      ...c.must.map((a) => ({ kind: 'must' as const, ...a })),
      ...c.mustNot.map((a) => ({ kind: 'mustNot' as const, ...a })),
    ];
    const tag = (a: (typeof checks)[number]) => `${a.kind}: ${a.label}`;
    const passes = checks.map(() => 0);
    const runs: RunResult[] = [];
    /** Per run: the outcome a metric reads, or undefined when the run is unmeasured. */
    const outcomes: (CaseOutcome<O> | undefined)[] = [];
    for (let run = 1; run <= n; run++) {
      const start = now();
      let output: O;
      try {
        const input = await step('input', c.input);
        const raw = await withTimeout(suite.subject, input, timeoutMs);
        output = await step('unparseable', () => suite.parse(raw));
      } catch (e) {
        if (!(e instanceof Unmeasured)) throw e;
        const unmeasured = { reason: e.reason, message: e.message };
        runs.push({ run, latencyMs: now() - start, failed: checks.map(tag), unmeasured });
        outcomes.push(undefined);
        continue;
      }
      const latencyMs = now() - start;
      const failed: string[] = [];
      const kept = new Map<string, boolean>();
      checks.forEach((a, i) => {
        let hit: unknown;
        try {
          hit = a.check(output);
        } catch (e) {
          throw new HarnessFault(
            `Case "${c.id}", ${tag(a)}: the predicate threw (${e instanceof Error ? e.message : e}).`,
          );
        }
        if (typeof hit !== 'boolean')
          throw new HarnessFault(
            `Case "${c.id}", ${tag(a)}: the predicate returned ${hit === null ? 'null' : typeof hit}, not a boolean.`,
          );
        kept.set(tag(a), hit === (a.kind === 'must'));
        if (kept.get(tag(a))) passes[i]++;
        else failed.push(tag(a));
      });
      runs.push({ run, latencyMs, failed });
      outcomes.push(metrics && outcomeOf(c.id, output, kept));
    }
    measuredCases.push({ c, n, checks, passes, runs, outcomes });
  }
  // Read once the runs are over; quality gates only hold against a baseline of the same model.
  const model = options.model?.() ?? { providers: [], models: [] };
  const modelMismatch =
    baseline && !sameModel(baseline.model, model)
      ? `model mismatch: the baseline ran on ${JSON.stringify(baseline.model)}, this run on ${JSON.stringify(model)}`
      : undefined;
  const cases: CaseResult[] = measuredCases.map(({ c, n, checks, passes, runs }) => {
    const assertions: AssertionResult[] = checks.map((a, i) => {
      const rate = passRate(passes[i], n);
      const key = assertionKey(c.id, a.kind, a.label);
      const baseN = baseline?.ns[key];
      const gate: QualityGate =
        a.kind === 'mustNot'
          ? { threshold: 1, verdict: decide(a.kind, rate, 1) }
          : metrics
            ? { threshold: null, verdict: 'diagnostic' }
            : modelMismatch
              ? { threshold: null, verdict: 'ungated', reason: modelMismatch }
              : baseN !== undefined && baseN !== n
                ? {
                    threshold: null,
                    verdict: 'ungated',
                    reason: `n mismatch: the baseline ran this assertion ${baseN} times, this run ${n}`,
                  }
                : gateQuality(rate, baseline?.rates[key], n);
      return {
        kind: a.kind,
        label: a.label,
        gate: a.kind === 'mustNot' ? 'safety' : metrics ? 'diagnostic' : 'quality',
        passes: passes[i],
        n,
        rate,
        ...gate,
      };
    });
    const measured = runs.filter((r) => !r.unmeasured);
    const latencies = measured.map((r) => r.latencyMs);
    return {
      id: c.id,
      n,
      measured: measured.length,
      unmeasured: n - measured.length,
      passed:
        measured.length === n &&
        assertions.every((a) => a.verdict === 'pass' || a.verdict === 'diagnostic'),
      latencyMs: {
        mean: latencies.length ? latencies.reduce((s, l) => s + l, 0) / latencies.length : null,
        max: latencies.length ? Math.max(...latencies) : null,
      },
      runs,
      assertions,
    };
  });
  const metricResults = metrics && scoreMetrics(metrics, measuredCases, baseline, modelMismatch);
  const unmeasured = cases.reduce((s, c) => s + c.unmeasured, 0);
  const complete = unmeasured === 0;
  const status = reportStatus({ complete, aa, cases, metrics: metricResults });
  return {
    suite: suite.name,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    model,
    policy: {
      defaultN,
      timeoutMs,
      safety: 'mustNot: zero tolerance, every run must keep it',
      quality: metrics
        ? 'metrics: one sample per run over every case (0 when a case is unmeasured, and the metric is then ungated as incomplete), gated at the A/A mean minus max(2 SE, 1 case) over >= 3 A/A runs on the same model and the same cases, the SE being the pooled per-run SD of every A/A sample over sqrt(n); ungated without them, too-noisy when n < 3 or the margin swallows the mean; must rates are diagnostics, not gated'
        : 'must: k-of-n at the A/A mean minus max(2 sample SD, 1 run) over >= 3 A/A runs on the same model; ungated without them, too-noisy when n < 3 or the margin swallows the mean',
      casePassed: metrics
        ? 'case passed: every run measured and every mustNot kept; its must rates are diagnostics, so its quality is judged by the metrics, not here'
        : 'case passed: every run measured and every assertion passed its gate',
    },
    complete,
    aa,
    status,
    passed: status === 'pass',
    unmeasured,
    cases,
    ...(metricResults && { metrics: metricResults }),
  };
}

/**
 * What a metric reads of one case in one run, frozen so a metric cannot change what another sees:
 * a deep-frozen structured clone of the output, and `kept` refusing a key the case does not declare.
 */
function outcomeOf<O>(caseId: string, output: O, kept: Map<string, boolean>): CaseOutcome<O> {
  let copy: O;
  try {
    copy = deepFreeze(structuredClone(output));
  } catch (e) {
    throw new HarnessFault(
      `Case "${caseId}": a metric suite's parsed output is not plain data (${e instanceof Error ? e.message : e}).`,
    );
  }
  return Object.freeze({
    caseId,
    output: copy,
    kept: (key: string) => {
      const hit = kept.get(key);
      if (hit === undefined)
        throw new HarnessFault(
          `Case "${caseId}" declares no assertion "${key}" (it declares ${[...kept.keys()].map((k) => `"${k}"`).join(', ')}).`,
        );
      return hit;
    },
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** A metrics declaration is a non-empty map of functions over cases that all run the same n. */
function validMetrics<I, O>(suite: RunnableSuite<I, O>, defaultN: number) {
  const { metrics } = suite;
  if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics))
    throw new HarnessFault(`Suite "${suite.name}": metrics must be an object of functions.`);
  const entries = Object.entries(metrics);
  if (entries.length === 0)
    throw new HarnessFault(`Suite "${suite.name}" declares no metric: omit metrics instead.`);
  for (const [name, fn] of entries) {
    if (!name.trim()) throw new HarnessFault(`Suite "${suite.name}" has an unnamed metric.`);
    if (typeof fn !== 'function')
      throw new HarnessFault(`Suite "${suite.name}": metric "${name}" must be a function.`);
  }
  if (new Set(suite.cases.map((c) => c.n ?? defaultN)).size !== 1)
    throw new HarnessFault(
      `Suite "${suite.name}" declares metrics, so every case must run the same number of times.`,
    );
  return metrics;
}

/**
 * Scores every metric once per run index over all cases (0 when a case of that run is
 * unmeasured) and gates its mean per metric. A throw or a value that is not a finite number in
 * [0, 1] is a harness fault.
 */
function scoreMetrics<O>(
  metrics: Record<string, Metric<O>>,
  measuredCases: { c: { id: string }; n: number; outcomes: (CaseOutcome<O> | undefined)[] }[],
  baseline: Baseline | undefined,
  modelMismatch: string | undefined,
): MetricResult[] {
  const [{ n }] = measuredCases;
  const cases = measuredCases.length;
  const caseIds = measuredCases.map(({ c }) => c.id).sort();
  const incompleteRuns = Array.from({ length: n }, (_, run) => run + 1).filter((run) =>
    measuredCases.some((c) => c.outcomes[run - 1] === undefined),
  );
  return Object.entries(metrics).map(([name, metric]) => {
    const samples = Array.from({ length: n }, (_, run) => {
      const outcomes = measuredCases.map((c) => c.outcomes[run]);
      if (outcomes.some((o) => o === undefined)) return 0;
      let value: unknown;
      try {
        value = metric(Object.freeze(outcomes) as CaseOutcome<O>[]);
      } catch (e) {
        throw new HarnessFault(
          `Run ${run + 1}: metric "${name}" threw (${e instanceof Error ? e.message : e}).`,
        );
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
        throw new HarnessFault(
          `Run ${run + 1}: metric "${name}" returned ${typeof value === 'number' ? value : typeof value}, not a rate in [0, 1].`,
        );
      return value;
    });
    const rate = samples.reduce((s, x) => s + x, 0) / n;
    const base = baseline?.metrics?.[name];
    const gate: QualityGate = incompleteRuns.length
      ? {
          threshold: null,
          verdict: 'ungated',
          reason: `incomplete: run ${incompleteRuns.join(', ')} has an unmeasured case, so its sample is 0 and the metric is not gated`,
        }
      : modelMismatch
        ? { threshold: null, verdict: 'ungated', reason: modelMismatch }
        : base && base.n !== n
          ? {
              threshold: null,
              verdict: 'ungated',
              reason: `n mismatch: the baseline ran this metric ${base.n} times, this run ${n}`,
            }
          : base && JSON.stringify(base.caseIds) !== JSON.stringify(caseIds)
            ? {
                threshold: null,
                verdict: 'ungated',
                reason: `case mismatch: the baseline measured this metric over ${JSON.stringify(base.caseIds)}, this run over ${JSON.stringify(caseIds)}`,
              }
            : gateMetric(rate, base?.samples, n, base?.caseIds.length ?? cases);
    return { name, n, cases, caseIds, samples, rate, ...gate };
  });
}
