export type IntentStatus =
  'created' | 'requires_confirmation' | 'processing' | 'completed' | 'unknown' | 'failed';
/**
 * The intent status edges the app may write; `transition` rejects any other. The insert (`created`)
 * is not an edge.
 * - any unsettled status except `processing` → `requires_confirmation`: a re-proposal with the
 *   same intent id (`transferMoney` answers 409 while a transfer is being sent; a
 *   proposal held for review by a matching pending transfer stays `created`, and the customer's
 *   "send anyway" re-proposes it: `created` → `requires_confirmation`)
 * - `requires_confirmation` → `processing`: the approval was consumed
 * - `processing` → `completed` | `unknown` | `failed`: the bank's answer to the dispatch, or
 *   reconciliation of a stale `processing` intent whose dispatch never finished (found →
 *   `completed`, bank 404 → `failed`)
 * - `unknown` | `failed` → `completed`, `unknown` → `failed`: reconciliation with the bank
 * The P0 money-path fixes needed no new edge.
 */
export const TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = {
  created: ['requires_confirmation'],
  requires_confirmation: ['requires_confirmation', 'processing'],
  processing: ['completed', 'unknown', 'failed'],
  unknown: ['requires_confirmation', 'completed', 'failed'],
  failed: ['requires_confirmation', 'completed'],
  completed: [],
};
/**
 * An intent status change that `TRANSITIONS` does not list; nothing was written. A plain `Error`,
 * not a `DomainError`: it escapes only on a bug, and that stays a 500.
 */
export class IllegalTransitionError extends Error {
  constructor(
    public id: string,
    public from: IntentStatus,
    public to: IntentStatus,
  ) {
    super(`Illegal intent transition ${from} → ${to} for ${id}.`);
    this.name = 'IllegalTransitionError';
  }
}
/** Every status `TRANSITIONS` lets move to `to`, in table order. */
export const predecessorsOf = (to: IntentStatus) =>
  (Object.keys(TRANSITIONS) as IntentStatus[]).filter((s) => TRANSITIONS[s].includes(to));
