import { bankRequest, BankError } from './client';
import { appDb } from '../db';
import type { Operation } from '../types';
type IntentRow = { status: string; bank_reference: string | null };
/**
 * Replaces an unverified intent outcome with what the bank reports for its reference. A lost
 * response is `unknown`, and an older transport `failed` may hide a completed operation, so both
 * are checked. A bank that cannot be reached leaves the intent as it was: nothing is guessed.
 */
export async function reconcileIntent(userId: string, intentId: string): Promise<void> {
  const db = appDb();
  const intent = db
    .prepare('SELECT status,bank_reference FROM intents WHERE id=? AND user_id=?')
    .get(intentId, userId) as IntentRow | undefined;
  if (!intent?.bank_reference || !['unknown', 'failed'].includes(intent.status)) return;
  try {
    const operation = await bankRequest<Operation>(
      userId,
      `/v1/operations/${encodeURIComponent(intent.bank_reference)}`,
    );
    db.prepare('UPDATE intents SET status=?,operation_id=?,error=NULL WHERE id=?').run(
      'completed',
      operation.id,
      intentId,
    );
  } catch (e) {
    if (!(e instanceof BankError) || e.status !== 404 || intent.status !== 'unknown') return;
    db.prepare('UPDATE intents SET status=?,error=? WHERE id=?').run(
      'failed',
      'The bank has no operation for this reference.',
      intentId,
    );
  }
}
