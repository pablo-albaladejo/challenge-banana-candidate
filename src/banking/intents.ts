import { intentById, transitionIntent, type IntentFields } from '../persistence/intents';
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
/** An intent status change that `TRANSITIONS` does not list; nothing was written. */
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
/**
 * Moves the intent to `to` and writes the given fields in one compare-and-set update, only from a
 * status whose `TRANSITIONS` list `to`. An unknown id writes nothing and returns
 * `{ changed: false }`; an edge outside the table writes nothing and throws
 * `IllegalTransitionError`. Normal flows never hit it: it means the intent changed under the
 * caller (a concurrent writer) or a bug, and the caller must not act as if the write happened.
 */
export function transition(
  id: string,
  to: IntentStatus,
  fields: Omit<IntentFields, 'status'> = {},
) {
  const from = (Object.keys(TRANSITIONS) as IntentStatus[]).filter((s) =>
    TRANSITIONS[s].includes(to),
  );
  if (transitionIntent(id, to, from, fields) > 0) return { changed: true, legal: true };
  const current = intentById(id)?.status as IntentStatus | undefined;
  if (!current) return { changed: false, legal: false };
  throw new IllegalTransitionError(id, current, to);
}
