// The exit code of `npm run eval`, so CI and a shell can tell a model failure from a broken
// harness and from a run that proved nothing. 0 pass (or a complete A/A candidate), 1 a model or
// quality failure or an incomplete report, 2 a harness fault or any unexpected error, 3 ungated.
import { reportStatus, type EvalReport, type ReportStatus } from './report';

export const exitCodes: Record<ReportStatus | 'harness', number> = {
  pass: 0,
  aa: 0,
  fail: 1,
  incomplete: 1,
  harness: 2,
  ungated: 3,
};

/** A report maps by its status (derived afresh); any thrown error is a harness fault. */
export function exitCodeFor(outcome: EvalReport | Error): number {
  if (outcome instanceof Error) return exitCodes.harness;
  return exitCodes[reportStatus(outcome)];
}
