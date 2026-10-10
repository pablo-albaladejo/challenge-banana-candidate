// Deterministic Clock and Ids for the dedicated "with a fixed clock" tests (plan §10.6). Only these
// two ports may be overridden when wiring a vertical; repos, registries and the bank stay real.
import type { Clock } from '../../src/shared/ports/clock';
import type { Ids } from '../../src/shared/ports/ids';
/** A clock that stands still at `startIso` until `advance(ms)` moves it. */
export function fixedClock(startIso = '2026-09-24T09:00:00.000Z'): Clock & {
  advance(ms: number): void;
} {
  let current = new Date(startIso).getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}
/** Ids `<prefix>-1`, `<prefix>-2`, … in call order. */
export function sequentialIds(prefix: string): Ids {
  let next = 0;
  return { uuid: () => `${prefix}-${++next}` };
}
