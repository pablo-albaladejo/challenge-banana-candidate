import { randomUUID } from 'node:crypto';
import * as bank from './bank';
import { HttpError } from '../auth';
import { consumeApproval, insertApproval, liveApprovalFor } from '../persistence/approvals';
import { pendingTwinsOf } from '../persistence/intents';
import { atomically } from '../persistence/statement';
import { reconcileIntent } from './reconcile';
import { transition } from './intents';
import type { ActionResult, RequiresReviewResult, ToolContext, TransferInput } from '../types';
const APPROVAL_TTL_MS = 10 * 60 * 1000;
/** Checks every pending twin with the bank, so the decision that follows sees what it settled. */
async function reconcileTwins(ctx: ToolContext, payload: string) {
  const twins = pendingTwinsOf(ctx.userId, payload, ctx.intentId);
  await Promise.allSettled(twins.map((twin) => reconcileIntent(ctx.userId, twin.id)));
}
/**
 * The hold on this transfer, if another intent of the customer with the same payload is still not
 * settled by the bank and is not the newest one the customer chose to send past. Two identical
 * transfers may both be legitimate (docs/contracts.md), so a match is surfaced, never merged. It
 * reads the store as it is now: callers decide on it without awaiting anything in between.
 */
function heldBy(ctx: ToolContext, payload: string): RequiresReviewResult | null {
  const [twin] = pendingTwinsOf(ctx.userId, payload, ctx.intentId);
  if (!twin || ctx.overridePendingIntentId === twin.id) return null;
  return {
    status: 'requires_review',
    pendingIntentId: twin.id,
    intentId: ctx.intentId,
    error: 'A matching transfer is still being verified with the bank.',
  };
}
/**
 * Money only moves after the customer reviews amount, source and destination: without an approval
 * the intent gets a pending proposal; with one, the proposal is consumed atomically, once, and the
 * intent moves to `processing` (stamped `dispatched_at`) in the same step: `null` means the caller
 * owns the dispatch. Throws `IllegalTransitionError` if another writer moved the intent first.
 */
export async function authorizeTransfer(
  ctx: ToolContext,
  input: TransferInput,
): Promise<ActionResult | null> {
  const accounts = await bank.accounts(ctx.userId);
  if (!accounts.some((a) => a.id === input.fromAccountId))
    throw new HttpError(403, 'This account does not belong to this person.');
  const contacts = await bank.contacts(ctx.userId);
  const destinations = [...accounts.map((a) => a.id), ...contacts.map((c) => c.id)];
  if (!destinations.includes(input.toAccountId))
    throw new HttpError(400, 'The destination account does not exist.');
  const payload = JSON.stringify(input);
  // A retry after an unverified outcome must not become a second payment by accident: hold the
  // proposal, and its confirmation, until the customer explicitly sends it past the newest pending
  // twin. An override naming any other intent (another customer's, an older twin, or one no longer
  // pending) is ignored. A held confirmation does not consume its approval, so it stays usable.
  await reconcileTwins(ctx, payload);
  // Taken after the bank awaits, so the approval expiry and the dispatch start are not early.
  const now = new Date().toISOString();
  // From here on nothing awaits. A confirmation re-checks the twins, consumes its approval and
  // claims the dispatch (`processing`) in one write transaction, so of two identical proposals
  // confirmed at once only the first claims it; the second sees it as a pending twin.
  const { approvalId } = ctx;
  if (approvalId)
    return atomically(() => {
      const held = heldBy(ctx, payload);
      if (held) return held;
      const consumed = consumeApproval({
        id: approvalId,
        userId: ctx.userId,
        intentId: ctx.intentId,
        payload,
        now,
      });
      if (consumed !== 1)
        throw new HttpError(409, 'This proposal has expired or was already used.');
      transition(ctx.intentId, 'processing', { dispatched_at: now });
      return null;
    });
  const held = heldBy(ctx, payload);
  if (held) return held;
  // The status first: if a confirmation moved the intent on meanwhile, this throws before an
  // approval nobody can use is written.
  transition(ctx.intentId, 'requires_confirmation');
  let approval = liveApprovalFor(ctx.intentId, ctx.userId, now);
  if (!approval) {
    approval = {
      id: randomUUID(),
      payload,
      expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
    };
    insertApproval({
      id: approval.id,
      userId: ctx.userId,
      intentId: ctx.intentId,
      payload: approval.payload,
      expiresAt: approval.expires_at,
    });
  }
  return {
    status: 'requires_confirmation',
    approval: { id: approval.id, payload: input, expiresAt: approval.expires_at },
    intentId: ctx.intentId,
  };
}
