import { randomUUID } from 'node:crypto';
import { BankError } from './client';
import * as bank from './bank';
import { intentById, updateIntent } from '../persistence/intents';
import type { Operation, ToolContext, TransferInput } from '../types';
/** One bank reference per intent: retries replay the original operation instead of adding one. */
function intentReference(intentId: string) {
  const row = intentById(intentId);
  if (row?.bank_reference) return row.bank_reference;
  const reference = randomUUID();
  updateIntent(intentId, { bank_reference: reference });
  return reference;
}
/** Bank attempts per dispatch; each one is bounded by `config.bankTimeoutMs`. */
export const DISPATCH_ATTEMPTS = 2;
/** Intents whose dispatch is in flight in this process; reconcile leaves them to the dispatch. */
const dispatching = new Set<string>();
/**
 * Whether this process is dispatching the intent right now. A restart empties it, so reconcile
 * recovers a crashed dispatch once it is stale, measured from `dispatched_at` (`created_at` on
 * rows written before migration 2).
 */
export const isDispatching = (intentId: string) => dispatching.has(intentId);
export async function dispatchTransfer(ctx: ToolContext, input: TransferInput): Promise<Operation> {
  const reference = intentReference(ctx.intentId);
  dispatching.add(ctx.intentId);
  try {
    for (let attempt = 0; attempt < DISPATCH_ATTEMPTS; attempt++) {
      try {
        return await bank.transfer(ctx.userId, input, reference);
      } catch (e) {
        if (!(e instanceof BankError) || e.status < 500 || attempt === DISPATCH_ATTEMPTS - 1)
          throw e;
      }
    }
    throw new BankError(504, 'The operation could not be completed.');
  } finally {
    dispatching.delete(ctx.intentId);
  }
}
