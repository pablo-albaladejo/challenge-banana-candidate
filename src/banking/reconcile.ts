import { BankError } from './client';
import * as bank from './bank';
import { config } from '../config';
import { DISPATCH_ATTEMPTS, isDispatching } from './dispatch';
import { intentOf, type IntentRow } from '../persistence/intents';
import { IllegalTransitionError, transition } from './intents';
/**
 * How old a `processing` intent must be before reconcile may settle it: twice the longest a
 * dispatch can take (`DISPATCH_ATTEMPTS` bank calls of at most `bankTimeoutMs` each), so a dispatch
 * still in flight is never overtaken. Read at call time, because `config` is mutable.
 */
export const staleProcessingMs = () => 2 * config.bankTimeoutMs * DISPATCH_ATTEMPTS;
/**
 * Whether the intent's dispatch started longer ago than any dispatch can last. Measured from
 * `dispatched_at` (set with `processing`), falling back to `created_at` on rows older than it.
 */
const stale = (intent: IntentRow) =>
  Date.now() - Date.parse(intent.dispatched_at ?? intent.created_at) > staleProcessingMs();
/** An outcome the bank has not verified: `unknown`, a transport `failed`, or a stale `processing`. */
function unverified(intent: IntentRow) {
  if (intent.status === 'unknown' || intent.status === 'failed') return true;
  return intent.status === 'processing' && stale(intent);
}
/**
 * Replaces an unverified intent outcome with what the bank reports for its reference. A lost
 * response is `unknown`, an older transport `failed` may hide a completed operation, and a
 * `processing` intent older than `staleProcessingMs` was left behind by a dispatch that never
 * finished (a restart or a killed request), so all three are checked. A bank that cannot be
 * reached leaves the intent as it was: nothing is guessed.
 */
export async function reconcileIntent(userId: string, intentId: string): Promise<void> {
  const intent = intentOf(intentId, userId);
  // A dispatch in flight here owns the outcome, whatever the intent's status or age.
  if (!intent?.bank_reference || isDispatching(intentId) || !unverified(intent)) return;
  let operation: Awaited<ReturnType<typeof bank.operation>>;
  try {
    operation = await bank.operation(userId, intent.bank_reference);
  } catch (e) {
    // A 404 only proves absence once no dispatch can still land: before that, leave it as it is.
    if (!(e instanceof BankError) || e.status !== 404 || intent.status === 'failed') return;
    if (!stale(intent)) return;
    settle(intentId, 'failed', { error: 'The bank has no operation for this reference.' });
    return;
  }
  settle(intentId, 'completed', { operation_id: operation.id, error: null });
}
/**
 * The intent was read before the bank call; if another writer settled it meanwhile (a dispatch that
 * finished, or a parallel reconcile), the compare-and-set rejects the edge and the first outcome
 * stays: reconcile never overwrites a newer status.
 */
function settle(...args: Parameters<typeof transition>) {
  try {
    transition(...args);
  } catch (e) {
    if (!(e instanceof IllegalTransitionError)) throw e;
  }
}
