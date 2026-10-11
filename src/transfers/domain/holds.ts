import type { RequiresReviewResult } from '../../types';
export const HELD_MESSAGE = 'A matching transfer is still being verified with the bank.';
/**
 * The hold on this transfer, if another intent of the customer with the same payload is still not
 * settled by the bank and is not the newest one the customer chose to send past. Two identical
 * transfers may both be legitimate (docs/contracts.md), so a match is surfaced, never merged.
 * `twins` are the customer's pending twins, newest first, as the store holds them now: callers
 * decide on it without awaiting anything in between.
 */
export function heldBy(
  twins: { id: string }[],
  intentId: string,
  overridePendingIntentId: string | undefined,
): RequiresReviewResult | null {
  const [twin] = twins;
  if (!twin || overridePendingIntentId === twin.id) return null;
  return {
    status: 'requires_review',
    pendingIntentId: twin.id,
    intentId,
    error: HELD_MESSAGE,
  };
}
