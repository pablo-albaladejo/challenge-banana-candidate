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
  gate: 'safety' | 'quality';
  passes: number;
  n: number;
  rate: number;
  threshold: number | null;
  verdict: Verdict;
  /** Why a quality assertion is `ungated` or `too-noisy`. */
  reason?: string;
};
export type CaseResult = {
  id: string;
  n: number;
  measured: number;
  unmeasured: number;
  /** Every assertion gated and passed, and no unmeasured run. */
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
  policy: { defaultN: number; timeoutMs: number; safety: string; quality: string };
  /** False when any run is unmeasured: the report is incomplete and the eval exits non-zero. */
  complete: boolean;
  /** Recorded with `--aa` as a baseline candidate: quality is never gated in it. */
  aa: boolean;
  status: ReportStatus;
  /** `status === 'pass'`. */
  passed: boolean;
  unmeasured: number;
  cases: CaseResult[];
};

/** The status, derived from the runs and verdicts, never from a stored field. */
export function reportStatus(report: Pick<EvalReport, 'complete' | 'aa' | 'cases'>): ReportStatus {
  const verdicts = report.cases.flatMap((c) => c.assertions.map((a) => a.verdict));
  if (!report.complete) return 'incomplete';
  if (verdicts.includes('fail')) return 'fail';
  if (report.aa) return 'aa';
  if (verdicts.some((v) => v === 'ungated' || v === 'too-noisy')) return 'ungated';
  return 'pass';
}

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

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
      a.verdict === 'pass' || a.verdict === 'fail' ? a.verdict.toUpperCase() : a.verdict,
    ]),
  );
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  const unmeasured = report.cases.flatMap((c) =>
    c.runs.flatMap((r) =>
      r.unmeasured
        ? [`${c.id} run ${r.run} unmeasured (${r.unmeasured.reason}): ${r.unmeasured.message}`]
        : [],
    ),
  );
  const reasons = report.cases.flatMap((c) =>
    c.assertions.flatMap((a) => (a.reason ? [`${c.id} · ${a.label}: ${a.reason}`] : [])),
  );
  const ungated = reasons.length;
  const latency = report.cases.map(
    (c) => `${c.id}: mean ${c.latencyMs.mean ?? '—'} ms, max ${c.latencyMs.max ?? '—'} ms`,
  );
  const status = {
    incomplete: `INCOMPLETE: ${report.unmeasured} unmeasured run${report.unmeasured === 1 ? '' : 's'} (never a pass)`,
    fail: 'FAIL',
    aa: 'A/A: complete, no safety violation; a baseline candidate for --baseline (quality not gated, not a pass)',
    ungated: `UNGATED: no failure, but ${ungated} quality assertion${ungated === 1 ? ' is' : 's are'} not gated, so this is not a pass. Record >= 3 A/A runs with --aa and gate with --baseline; raise N if too noisy`,
    pass: 'PASS',
  }[reportStatus(report)];
  return [
    `eval ${report.suite} · ${report.startedAt} · model: ${model}`,
    line(header),
    ...rows.map(line),
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
