import {
  PENDING_TRANSFERS_LIMIT,
  failedSince,
  toPendingTransfer,
  type PendingTransfer,
} from '../../domain/pending-transfer';
import type { Clock } from '../../../shared/ports/clock';
import type { IntentRepository } from '../ports/intent-repository';
import type { ReconcileIntent } from './reconcile-intent';
type Deps = { intents: IntentRepository; clock: Clock; reconcileIntent: ReconcileIntent };
/**
 * The customer's latest transfers worth checking (`unknown`, `processing`, and `failed` ones that
 * reached the bank in the last 24 h), each checked with the bank first, so the customer sees the
 * bank's answer instead of a stale "did not confirm". A check that fails leaves its intent as it
 * was; the list still loads.
 */
export const makeListPendingTransfers =
  ({ intents, clock, reconcileIntent }: Deps) =>
  async ({ userId }: { userId: string }): Promise<PendingTransfer[]> => {
    const pending = intents.pendingOf(userId, PENDING_TRANSFERS_LIMIT, failedSince(clock.now()));
    await Promise.allSettled(
      pending.map((intent) => reconcileIntent({ userId, intentId: intent.id })),
    );
    return pending.map((before) => toPendingTransfer(intents.byId(before.id) ?? before));
  };
