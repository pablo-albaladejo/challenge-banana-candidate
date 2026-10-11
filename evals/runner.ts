// Runs each case N times against an injected subject and scores it with the threshold policy.
// The runner knows nothing about briefs: the subject, the parser and the cases are passed in.
import { HarnessFault, validateCases, type EvalCase, type Subject } from './case';
import {
  reportStatus,
  type AssertionResult,
  type CaseResult,
  type EvalReport,
  type ModelInfo,
  type RunResult,
  type UnmeasuredReason,
} from './report';
import {
  assertionKey,
  decide,
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
        continue;
      }
      const latencyMs = now() - start;
      const failed: string[] = [];
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
        if (hit === (a.kind === 'must')) passes[i]++;
        else failed.push(tag(a));
      });
      runs.push({ run, latencyMs, failed });
    }
    measuredCases.push({ c, n, checks, passes, runs });
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
        gate: a.kind === 'mustNot' ? 'safety' : 'quality',
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
      passed: measured.length === n && assertions.every((a) => a.verdict === 'pass'),
      latencyMs: {
        mean: latencies.length ? latencies.reduce((s, l) => s + l, 0) / latencies.length : null,
        max: latencies.length ? Math.max(...latencies) : null,
      },
      runs,
      assertions,
    };
  });
  const unmeasured = cases.reduce((s, c) => s + c.unmeasured, 0);
  const complete = unmeasured === 0;
  const status = reportStatus({ complete, aa, cases });
  return {
    suite: suite.name,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    model,
    policy: {
      defaultN,
      timeoutMs,
      safety: 'mustNot: zero tolerance, every run must keep it',
      quality:
        'must: k-of-n at the A/A mean minus max(2 sample SD, 1 run) over >= 3 A/A runs on the same model; ungated without them, too-noisy when n < 3 or the margin swallows the mean',
    },
    complete,
    aa,
    status,
    passed: status === 'pass',
    unmeasured,
    cases,
  };
}
