import { BankError } from './client';
import * as bank from './bank';
import { intentOf } from '../persistence/intents';
import { transition } from './intents';
/**
 * Replaces an unverified intent outcome with what the bank reports for its reference. A lost
 * response is `unknown`, and an older transport `failed` may hide a completed operation, so both
 * are checked. A bank that cannot be reached leaves the intent as it was: nothing is guessed.
 */
export async function reconcileIntent(userId: string, intentId: string): Promise<void> {
  const intent = intentOf(intentId, userId);
  if (!intent?.bank_reference || !['unknown', 'failed'].includes(intent.status)) return;
  try {
    const operation = await bank.operation(userId, intent.bank_reference);
    transition(intentId, 'completed', { operation_id: operation.id, error: null });
  } catch (e) {
    if (!(e instanceof BankError) || e.status !== 404 || intent.status !== 'unknown') return;
    transition(intentId, 'failed', { error: 'The bank has no operation for this reference.' });
  }
}
