import { ConflictError } from '../../../shared/domain/errors';
import { approvalExpiresAt } from '../../domain/approval';
import { heldBy } from '../../domain/holds';
import {
  firstTimeReconcileCandidates,
  preflightChecks,
  type PreflightCheck,
} from '../../domain/preflight';
import { assertKnownDestination, assertOwnsSource, payloadOf } from '../../domain/transfer';
import type { Clock } from '../../../shared/ports/clock';
import type { Ids } from '../../../shared/ports/ids';
import type { UnitOfWork } from '../../../shared/ports/unit-of-work';
import type {
  RequiresConfirmationResult,
  RequiresReviewResult,
  ToolContext,
  TransferInput,
} from '../../../types';
import type { IntentRow } from '../../domain/intent';
import type { ApprovalRepository } from '../ports/approval-repository';
import type { IntentRepository } from '../ports/intent-repository';
import type { TransfersBank } from '../ports/transfers-bank';
import type { ReconcileIntent } from '../use-cases/reconcile-intent';
import type { TransitionIntent } from './transition-intent';
type Deps = {
  bank: TransfersBank;
  intents: IntentRepository;
  approvals: ApprovalRepository;
  unitOfWork: UnitOfWork;
  clock: Clock;
  ids: Ids;
  transition: TransitionIntent;
  reconcileIntent: ReconcileIntent;
};
/**
 * Money only moves after the customer reviews amount, source and destination: without an approval
 * the intent gets a pending proposal; with one, the proposal is consumed atomically, once, and the
 * intent moves to `processing` (stamped `dispatched_at`) in the same step: `null` means the caller
 * owns the dispatch. Throws `IllegalTransitionError` if another writer moved the intent first.
 */
export function makeAuthorizeTransfer(deps: Deps) {
  const { bank, intents, approvals, unitOfWork, clock, ids, transition, reconcileIntent } = deps;
  /** Checks every pending twin with the bank, so the decision that follows sees what it settled. */
  async function reconcileTwins(ctx: ToolContext, payload: string) {
    const twins = intents.pendingTwinsOf(ctx.userId, payload, ctx.intentId);
    await Promise.allSettled(
      twins.map((twin) => reconcileIntent({ userId: ctx.userId, intentId: twin.id })),
    );
  }
  /**
   * The advisory inputs of the pre-flight checks: the customer's intents and movements, and a
   * bounded reconcile of the failed/unknown intents to the recipient, run concurrently with the
   * movements, so a stored `failed` that the bank completed is not read as "never paid". The intent
   * asking and its pending twins are left to the hold. Advisory: a store or bank that fails here
   * leaves the checks with less to go on, never the proposal failing. `null` movements: the bank
   * could not list them.
   */
  async function advisoryInputs(
    ctx: ToolContext,
    input: TransferInput,
    payload: string,
    ownIds: string[],
  ) {
    let read: IntentRow[] = [];
    let candidates: string[] = [];
    try {
      read = intents.ofCustomer(ctx.userId);
      const twins = intents.pendingTwinsOf(ctx.userId, payload, ctx.intentId);
      if (!ownIds.includes(input.toAccountId))
        candidates = firstTimeReconcileCandidates(read, input.toAccountId, [
          ctx.intentId,
          ...twins.map((t) => t.id),
        ]);
    } catch {
      // Unreadable history: the checks go on without it.
    }
    const [listed] = await Promise.allSettled([
      bank.movements(ctx.userId),
      Promise.allSettled(
        candidates.map((intentId) => reconcileIntent({ userId: ctx.userId, intentId })),
      ),
    ]);
    // Read again only when a reconcile may have settled one of them.
    try {
      if (candidates.length) read = intents.ofCustomer(ctx.userId);
    } catch {
      // Keep the first read.
    }
    return { intents: read, movements: listed.status === 'fulfilled' ? listed.value : null };
  }
  /** The hold on this transfer, read from the store as it is now (see `heldBy`). */
  const holdOf = (ctx: ToolContext, payload: string) =>
    heldBy(
      intents.pendingTwinsOf(ctx.userId, payload, ctx.intentId),
      ctx.intentId,
      ctx.overridePendingIntentId,
    );
  return async (
    ctx: ToolContext,
    input: TransferInput,
  ): Promise<RequiresReviewResult | RequiresConfirmationResult | null> => {
    const accounts = await bank.accounts(ctx.userId);
    // When the balance the checks quote was read.
    const asOf = clock.now().toISOString();
    assertOwnsSource(accounts, input);
    const contacts = await bank.contacts(ctx.userId);
    assertKnownDestination(accounts, contacts, input);
    const payload = payloadOf(input);
    // A retry after an unverified outcome must not become a second payment by accident: hold the
    // proposal, and its confirmation, until the customer explicitly sends it past the newest
    // pending twin. An override naming any other intent (another customer's, an older twin, or one
    // no longer pending) is ignored. A held confirmation does not consume its approval, so it stays
    // usable.
    await reconcileTwins(ctx, payload);
    const { approvalId } = ctx;
    // Advisory, proposal only: confirming makes no movements call and no first-time reconcile.
    const advisory = approvalId
      ? null
      : await advisoryInputs(
          ctx,
          input,
          payload,
          accounts.map((a) => a.id),
        );
    // Taken after the bank awaits, so the approval expiry and the dispatch start are not early.
    const now = clock.now().toISOString();
    // From here on nothing awaits. A confirmation re-checks the twins, consumes its approval and
    // claims the dispatch (`processing`) in one write transaction, so of two identical proposals
    // confirmed at once only the first claims it; the second sees it as a pending twin.
    if (approvalId)
      return unitOfWork.atomically(() => {
        const held = holdOf(ctx, payload);
        if (held) return held;
        const consumed = approvals.consume({
          id: approvalId,
          userId: ctx.userId,
          intentId: ctx.intentId,
          payload,
          now,
        });
        if (consumed !== 1)
          throw new ConflictError('This proposal has expired or was already used.');
        transition(ctx.intentId, 'processing', { dispatched_at: now });
        return null;
      });
    const twins = intents.pendingTwinsOf(ctx.userId, payload, ctx.intentId);
    const held = heldBy(twins, ctx.intentId, ctx.overridePendingIntentId);
    if (held) return held;
    // Computed before the status moves, and fail-soft, so a check that throws can never leave the
    // intent awaiting confirmation without an approval.
    let checks: PreflightCheck[] = [];
    try {
      checks = preflightChecks({
        transfer: input,
        accounts,
        contacts,
        intents: advisory?.intents ?? [],
        movements: advisory?.movements ?? null,
        // Not held with a twin left means the customer sent past the newest one.
        overriddenTwin: twins[0] ?? null,
        asOf,
      });
    } catch {
      // The checks are advisory: the proposal goes on without them.
    }
    // The status first: if a confirmation moved the intent on meanwhile, this throws before an
    // approval nobody can use is written.
    transition(ctx.intentId, 'requires_confirmation');
    // A reused live approval keeps the checks it was shown with, so the card and the model always
    // see the same checks for the same approval.
    let approval = approvals.liveFor(ctx.intentId, ctx.userId, now);
    if (!approval) {
      approval = { id: ids.uuid(), payload, expires_at: approvalExpiresAt(clock.now()), checks };
      approvals.insert({
        id: approval.id,
        userId: ctx.userId,
        intentId: ctx.intentId,
        payload: approval.payload,
        expiresAt: approval.expires_at,
        checks,
      });
    }
    return {
      status: 'requires_confirmation',
      approval: { id: approval.id, payload: input, expiresAt: approval.expires_at },
      intentId: ctx.intentId,
      checks: approval.checks,
    };
  };
}
export type AuthorizeTransfer = ReturnType<typeof makeAuthorizeTransfer>;
