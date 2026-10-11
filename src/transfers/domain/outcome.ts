import { BankFailure } from '../../shared/domain/bank-failure';
import type { ActionResult, TransferInput } from '../../types';
import type { IntentRow } from './intent';
/** Bank attempts per dispatch; each one is bounded by `config.bankTimeoutMs`. */
export const DISPATCH_ATTEMPTS = 2;
/** Only an unreachable bank is retried, and never on the last attempt. */
export const shouldRetryDispatch = (error: unknown, attempt: number) =>
  error instanceof BankFailure && error.reason === 'unreachable' && attempt < DISPATCH_ATTEMPTS - 1;
export const UNCONFIRMED_MESSAGE =
  'The bank did not confirm this transfer. It will be checked with the bank before any retry.';
/**
 * The status a failed dispatch leaves. A 5xx or a lost response does not prove the bank rejected
 * the transfer: it may have committed, so it is `unknown`; anything else is `failed`.
 */
export function dispatchOutcome(error: unknown): { status: 'unknown' | 'failed'; error: string } {
  if (error instanceof BankFailure && error.reason === 'unreachable')
    return { status: 'unknown', error: UNCONFIRMED_MESSAGE };
  return { status: 'failed', error: error instanceof Error ? error.message : 'Transfer error' };
}
export const CHANGED_STATE_MESSAGE =
  'This transfer changed state while it was being sent. Check its status before retrying.';
/** The intent's stored outcome as a result: what the record says, not what this caller expected. */
export function storedOutcome(row: IntentRow, input: TransferInput): ActionResult {
  if (row.status === 'completed')
    return {
      status: 'completed',
      operation: {
        ...input,
        id: row.operation_id,
        userId: row.user_id,
        reference: row.bank_reference,
        status: 'completed',
      },
      intentId: row.id,
      replay: true,
    };
  return {
    status: row.status,
    error: CHANGED_STATE_MESSAGE,
    intentId: row.id,
  };
}
