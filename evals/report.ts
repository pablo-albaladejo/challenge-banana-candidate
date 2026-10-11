// The eval report: a JSON artifact (each case × run × assertion) and the console table.
import fs from 'node:fs';
import path from 'node:path';
import { HarnessFault, type AssertionKind } from './case';
import type { Verdict } from './thresholds';

export type UnmeasuredReason = 'input' | 'error' | 'timeout' | 'unparseable';
export type ModelInfo = { providers: string[]; models: string[] };
export type RunResult = {
  run: number;
  latencyMs: number;
  /** `kind: label` of every assertion this run failed; all of them when it is unmeasured. */
  failed: string[];
  unmeasured?: { reason: UnmeasuredReason; message: string };
};
export type AssertionResult = {
  kind: AssertionKind;
  label: string;
  /** `diagnostic`: a `must` of a suite gated by its metrics, reported but not gated. */
  gate: 'safety' | 'quality' | 'diagnostic';
  passes: number;
  n: number;
  rate: number;
  threshold: number | null;
  verdict: Verdict;
  /** Why a quality assertion is `ungated` or `too-noisy`. */
  reason?: string;
};
/** A suite-declared metric: one sample per run over every case (0 for a run with an unmeasured case). */
export type MetricResult = {
  name: string;
  /** Runs, each scored over all `cases` cases. */
  n: number;
  cases: number;
  /** The sorted ids of the cases measured: a baseline only gates the same set. */
  caseIds: string[];
  samples: number[];
  /** The mean of the samples. */
  rate: number;
  threshold: number | null;
  verdict: Verdict;
  /** Why the metric is `ungated` (incl. `incomplete`, `case mismatch`) or `too-noisy`. */
  reason?: string;
};
export type CaseResult = {
  id: string;
  n: number;
  measured: number;
  unmeasured: number;
  /**
   * No unmeasured run and every assertion passed its gate. In a suite with metrics the `must`
   * rates are diagnostics, so this only says the case was measured and kept every `mustNot`: its
   * quality is in the metrics. `policy.casePassed` states which reading applies.
   */
  passed: boolean;
  /** Over measured runs; null when none was measured. */
  latencyMs: { mean: number | null; max: number | null };
  runs: RunResult[];
  assertions: AssertionResult[];
};
/**
 * `incomplete`: a run is unmeasured. `fail`: an assertion failed its gate. `aa`: a complete A/A
 * baseline candidate with no safety violation. `ungated`: complete, no failure, but a quality
 * assertion is `ungated` or `too-noisy`, so nothing proves it. `pass`: every gate armed and passed.
 */
export type ReportStatus = 'pass' | 'fail' | 'incomplete' | 'ungated' | 'aa';
export type EvalReport = {
  suite: string;
  startedAt: string;
  finishedAt: string;
  model: ModelInfo;
  policy: {
    defaultN: number;
    timeoutMs: number;
    safety: string;
    quality: string;
    /** What a case's `passed` means in this report (it differs in a suite with metrics). */
    casePassed: string;
  };
  /** False when any run is unmeasured: the report is incomplete and the eval exits non-zero. */
  complete: boolean;
  /** Recorded with `--aa` as a baseline candidate: quality is never gated in it. */
  aa: boolean;
  status: ReportStatus;
  /** `status === 'pass'`. */
  passed: boolean;
  unmeasured: number;
  cases: CaseResult[];
  /** Only when the suite declares metrics: quality is then gated here, not per assertion. */
  metrics?: MetricResult[];
};

/** The status, derived from the runs and verdicts, never from a stored field. */
export function reportStatus(
  report: Pick<EvalReport, 'complete' | 'aa' | 'cases' | 'metrics'>,
): ReportStatus {
  const verdicts = [
    ...report.cases.flatMap((c) => c.assertions.map((a) => a.verdict)),
    ...(report.metrics ?? []).map((m) => m.verdict),
  ];
  if (!report.complete) return 'incomplete';
  if (verdicts.includes('fail')) return 'fail';
  if (report.aa) return 'aa';
  if (verdicts.some((v) => v === 'ungated' || v === 'too-noisy')) return 'ungated';
  return 'pass';
}

const percent = (rate: number) => `${Math.round(rate * 100)}%`;
const verdict = (v: Verdict) => (v === 'pass' || v === 'fail' ? v.toUpperCase() : v);

export function formatReport(report: EvalReport): string {
  const model = report.model.providers.length
    ? `${report.model.providers.join(', ')} (${report.model.models.join(', ') || 'unknown model'})`
    : 'none called';
  const header = ['case', 'kind', 'assertion', 'passes', 'rate', 'threshold', 'verdict'];
  const rows = report.cases.flatMap((c) =>
    c.assertions.map((a) => [
      c.id,
      a.kind,
      a.label,
      `${a.passes}/${a.n}`,
      percent(a.rate),
      a.threshold === null ? '—' : percent(a.threshold),
      verdict(a.verdict),
    ]),
  );
  const table = (head: string[], body: string[][]) => {
    const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
    const line = (cells: string[]) =>
      cells
        .map((cell, i) => cell.padEnd(widths[i]))
        .join('  ')
        .trimEnd();
    return [head, ...body].map(line);
  };
  const metrics = report.metrics?.length
    ? table(
        ['metric', 'cases', 'runs', 'rate', 'threshold', 'verdict', 'samples'],
        report.metrics.map((m) => [
          m.name,
          String(m.cases),
          String(m.n),
          percent(m.rate),
          m.threshold === null ? '—' : percent(m.threshold),
          verdict(m.verdict),
          m.samples.map(percent).join(' '),
        ]),
      )
    : [];
  const unmeasured = report.cases.flatMap((c) =>
    c.runs.flatMap((r) =>
      r.unmeasured
        ? [`${c.id} run ${r.run} unmeasured (${r.unmeasured.reason}): ${r.unmeasured.message}`]
        : [],
    ),
  );
  const reasons = [
    ...(report.metrics ?? []).flatMap((m) => (m.reason ? [`metric ${m.name}: ${m.reason}`] : [])),
    ...report.cases.flatMap((c) =>
      c.assertions.flatMap((a) => (a.reason ? [`${c.id} · ${a.label}: ${a.reason}`] : [])),
    ),
  ];
  const ungated = reasons.length;
  const latency = report.cases.map(
    (c) => `${c.id}: mean ${c.latencyMs.mean ?? '—'} ms, max ${c.latencyMs.max ?? '—'} ms`,
  );
  const status = {
    incomplete: `INCOMPLETE: ${report.unmeasured} unmeasured run${report.unmeasured === 1 ? '' : 's'} (never a pass)`,
    fail: 'FAIL',
    aa: 'A/A: complete, no safety violation; a baseline candidate for --baseline (quality not gated, not a pass)',
    ungated: `UNGATED: no failure, but ${ungated} quality gate${ungated === 1 ? ' is' : 's are'} not gated, so this is not a pass. Record >= 3 A/A runs with --aa and gate with --baseline; raise N if too noisy`,
    pass: 'PASS',
  }[reportStatus(report)];
  return [
    `eval ${report.suite} · ${report.startedAt} · model: ${model}`,
    ...table(header, rows),
    ...metrics,
    ...unmeasured,
    ...reasons,
    `latency: ${latency.join('; ')}`,
    status,
  ].join('\n');
}

/** Reads a report written by `writeReport` (an A/A baseline); an unreadable file is a harness fault. */
export function readReport(file: string): EvalReport {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as EvalReport;
  } catch (e) {
    throw new HarnessFault(
      `Cannot read the report ${file}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function writeReport(report: EvalReport, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

/** `.eval-results/<suite>-<startedAt>.json` (gitignored), with characters unsafe in file names replaced. */
export function defaultReportPath(report: EvalReport, root = process.cwd()) {
  const slug = report.suite.replace(/[^A-Za-z0-9._-]+/g, '-');
  return path.join(root, '.eval-results', `${slug}-${report.startedAt.replaceAll(':', '-')}.json`);
}
