import { BankFailure } from '../../shared/domain/bank-failure';
import { DISPATCH_ATTEMPTS } from './outcome';
import type { IntentFields, IntentRow } from './intent';
import type { IntentStatus } from './transitions';
/**
 * How old a `processing` intent must be before reconcile may settle it: twice the longest a
 * dispatch can take (`DISPATCH_ATTEMPTS` bank calls of at most `bankTimeoutMs` each), so a dispatch
 * still in flight is never overtaken.
 */
export const staleProcessingMs = (bankTimeoutMs: number) => 2 * bankTimeoutMs * DISPATCH_ATTEMPTS;
/**
 * Whether the intent's dispatch started longer ago than any dispatch can last. Measured from
 * `dispatched_at` (set with `processing`), falling back to `created_at` on rows older than it.
 */
export const isStale = (intent: IntentRow, nowMs: number, staleMs: number) =>
  nowMs - Date.parse(intent.dispatched_at ?? intent.created_at) > staleMs;
/** An outcome the bank has not verified: `unknown`, a transport `failed`, or a stale `processing`. */
export function isUnverified(intent: IntentRow, nowMs: number, staleMs: number) {
  if (intent.status === 'unknown' || intent.status === 'failed') return true;
  return intent.status === 'processing' && isStale(intent, nowMs, staleMs);
}
/**
 * Whether to ask the bank about the intent: it reached the bank (a reference), no dispatch in this
 * process owns it (whatever its status or age), and its outcome is unverified.
 */
export const shouldReconcile = (
  intent: IntentRow | undefined,
  dispatching: boolean,
  nowMs: number,
  staleMs: number,
): intent is IntentRow & { bank_reference: string } =>
  !!intent?.bank_reference && !dispatching && isUnverified(intent, nowMs, staleMs);
export const NO_OPERATION_MESSAGE = 'The bank has no operation for this reference.';
/**
 * What the bank's answer for the intent's reference settles: the operation it found completes the
 * intent; a 404 only proves absence once no dispatch can still land, and never touches a `failed`
 * intent; a bank that cannot be reached settles nothing (nothing is guessed). `nowMs` is read after
 * the bank answered.
 */
export function reconcileDecision(
  intent: IntentRow,
  lookup: { operation: { id: string } } | { error: unknown },
  nowMs: number,
  staleMs: number,
): { to: IntentStatus; fields: Omit<IntentFields, 'status'> } | null {
  if ('operation' in lookup)
    return { to: 'completed', fields: { operation_id: lookup.operation.id, error: null } };
  const { error } = lookup;
  if (!(error instanceof BankFailure) || error.reason !== 'notFound' || intent.status === 'failed')
    return null;
  if (!isStale(intent, nowMs, staleMs)) return null;
  return { to: 'failed', fields: { error: NO_OPERATION_MESSAGE } };
}
