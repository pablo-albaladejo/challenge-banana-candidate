// npm run eval -- <suite.ts> [--aa | --baseline aa1.json --baseline aa2.json --baseline aa3.json]
//   [--out report.json] [--n 3] [--timeout-ms 120000]
// Runs a suite module (default export: EvalSuite) against the real model gateway. It spends real
// quota, so it is never part of `npm test` or the hooks. Exit codes (evals/exit-code.ts): 0 pass,
// or a complete --aa run with no safety violation; 1 a failed gate or an unmeasured run
// (incomplete); 2 a harness fault (bad arguments, a malformed golden file or baseline, any
// unexpected error); 3 ungated (complete, no failure, but quality not proven).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { HarnessFault, type EvalSuite } from '../evals/case';
import { exitCodeFor } from '../evals/exit-code';
import { gatewayModel } from '../evals/model';
import { defaultReportPath, formatReport, readReport, writeReport } from '../evals/report';
import { runSuite } from '../evals/runner';
import { baselineFromReports } from '../evals/thresholds';
// Loads .env.local and .env (OPENAI_API_KEY, MODEL_PROVIDER) the way the app does.
import '../src/platform/config';

const usage =
  'Usage: npm run eval -- <suite.ts> [--aa | --baseline a.json --baseline b.json --baseline c.json] [--out file] [--n 3] [--timeout-ms 120000]';

const options = {
  aa: { type: 'boolean', default: false },
  baseline: { type: 'string', multiple: true },
  out: { type: 'string' },
  n: { type: 'string' },
  'timeout-ms': { type: 'string' },
} as const;

/** Unknown or malformed flags are the caller's mistake: a harness fault with the usage line. */
const parse = () => {
  try {
    return parseArgs({ allowPositionals: true, options });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS_'))
      throw new HarnessFault(`${(e as Error).message}\n${usage}`);
    throw e;
  }
};

try {
  const { values, positionals } = parse();
  if (positionals.length !== 1) throw new HarnessFault(usage);
  const positive = (flag: string, value?: string) => {
    if (value === undefined) return undefined;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1)
      throw new HarnessFault(`--${flag} must be a positive integer.`);
    return number;
  };
  const suite: EvalSuite<unknown, unknown> = (
    await import(pathToFileURL(path.resolve(positionals[0])).href)
  ).default;
  if (
    !suite?.name ||
    !Array.isArray(suite.cases) ||
    typeof suite.subject !== 'function' ||
    typeof suite.parse !== 'function'
  )
    throw new HarnessFault(`${positionals[0]} has no EvalSuite default export.`);
  if (values.aa && values.baseline?.length)
    throw new HarnessFault('--aa records a baseline candidate; it cannot take --baseline.');
  const files = values.baseline?.map((file) => path.resolve(file)) ?? [];
  if (new Set(files).size !== files.length)
    throw new HarnessFault('--baseline repeats a file: give distinct A/A reports.');
  const baseline = files.length ? baselineFromReports(files.map(readReport)) : undefined;
  const model = gatewayModel();
  const report = await runSuite(
    { ...suite, subject: suite.subject(model) },
    {
      defaultN: positive('n', values.n),
      timeoutMs: positive('timeout-ms', values['timeout-ms']),
      baseline,
      aa: values.aa,
      model: model.observed,
    },
  );
  const out = values.out ?? defaultReportPath(report);
  writeReport(report, out);
  console.log(formatReport(report));
  console.log(`report: ${out}`);
  process.exitCode = exitCodeFor(report);
} catch (e) {
  // Anything thrown outside a measured run is the harness's fault, never the model's.
  console.error(
    e instanceof HarnessFault
      ? `Harness fault: ${e.message}`
      : `Harness fault (unexpected error): ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
  );
  process.exitCode = exitCodeFor(e instanceof Error ? e : new Error(String(e)));
}
