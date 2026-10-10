import { intentById, updateIntent, type IntentFields } from '../persistence/intents';
export type IntentStatus =
  'created' | 'requires_confirmation' | 'processing' | 'completed' | 'unknown' | 'failed';
/**
 * The intent status edges the app writes today, documentation only: `transition` reports whether
 * an edge is listed but does not enforce it yet. The insert (`created`) is not an edge.
 * - any unsettled status → `requires_confirmation`: a re-proposal with the same intent id
 * - `requires_confirmation` → `processing`: the approval was consumed
 * - `processing` → `completed` | `unknown` | `failed`: the bank's answer to the dispatch
 * - `unknown` | `failed` → `completed`, `unknown` → `failed`: reconciliation with the bank
 */
export const TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = {
  created: ['requires_confirmation'],
  requires_confirmation: ['requires_confirmation', 'processing'],
  processing: ['requires_confirmation', 'completed', 'unknown', 'failed'],
  unknown: ['requires_confirmation', 'completed', 'failed'],
  failed: ['requires_confirmation', 'completed'],
  completed: [],
};
/**
 * Writes the status and the given fields in one update, whatever the current status is.
 * `changed` says whether the intent exists; `legal` whether the edge is listed in `TRANSITIONS`.
 */
export function transition(
  id: string,
  to: IntentStatus,
  fields: Omit<IntentFields, 'status'> = {},
) {
  const from = intentById(id)?.status as IntentStatus | undefined;
  const changed = updateIntent(id, { ...fields, status: to }) > 0;
  return { changed, legal: !!from && !!TRANSITIONS[from]?.includes(to) };
}
