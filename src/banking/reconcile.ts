import { bankRequest, BankError } from './client';
import { intentOf, updateIntent } from '../persistence/intents';
import type { Operation } from '../types';
/**
 * Replaces an unverified intent outcome with what the bank reports for its reference. A lost
 * response is `unknown`, and an older transport `failed` may hide a completed operation, so both
 * are checked. A bank that cannot be reached leaves the intent as it was: nothing is guessed.
 */
export async function reconcileIntent(userId: string, intentId: string): Promise<void> {
  const intent = intentOf(intentId, userId);
  if (!intent?.bank_reference || !['unknown', 'failed'].includes(intent.status)) return;
  try {
    const operation = await bankRequest<Operation>(
      userId,
      `/v1/operations/${encodeURIComponent(intent.bank_reference)}`,
    );
    updateIntent(intentId, { status: 'completed', operation_id: operation.id, error: null });
  } catch (e) {
    if (!(e instanceof BankError) || e.status !== 404 || intent.status !== 'unknown') return;
    updateIntent(intentId, {
      status: 'failed',
      error: 'The bank has no operation for this reference.',
    });
  }
}
