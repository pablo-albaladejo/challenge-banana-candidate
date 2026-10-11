import { ConflictError, ForbiddenError } from '../../../shared/domain/errors';
import { IllegalTransitionError } from '../../domain/transitions';
import { assertSameIntent, parseTransfer, payloadOf } from '../../domain/transfer';
import { dispatchOutcome, storedOutcome } from '../../domain/outcome';
import type { Clock } from '../../../shared/ports/clock';
import type { ActionResult, Operation, ToolContext } from '../../../types';
import type { CustomerDirectory } from '../ports/customer-directory';
import type { EventLog } from '../ports/event-log';
import type { IntentRepository } from '../ports/intent-repository';
import type { AuthorizeTransfer } from '../services/authorize-transfer';
import type { DispatchTransfer } from '../services/dispatch-transfer';
import { makeRecordOutcome } from '../services/record-outcome';
import type { TransitionIntent } from '../services/transition-intent';
import type { ReconcileIntent } from './reconcile-intent';
type Deps = {
  intents: IntentRepository;
  customers: CustomerDirectory;
  events: EventLog;
  clock: Clock;
  transition: TransitionIntent;
  reconcileIntent: ReconcileIntent;
  authorizeTransfer: AuthorizeTransfer;
  dispatchTransfer: DispatchTransfer;
};
/** The run's server-side identity plus the raw model (or UI) arguments, validated here. */
export type TransferMoneyCommand = ToolContext & { args: unknown };
/**
 * Proposes, confirms and sends a transfer for one intent: a proposal without an approval, the
 * dispatch with one. Every outcome is recorded on the intent before it is answered.
 */
export function makeTransferMoney(deps: Deps) {
  const { intents, customers, events, clock, reconcileIntent, authorizeTransfer } = deps;
  const { dispatchTransfer } = deps;
  const record = makeRecordOutcome(deps);
  return async ({ args, ...ctx }: TransferMoneyCommand): Promise<ActionResult> => {
    if (customers.roleOf(ctx.userId) !== 'customer')
      throw new ForbiddenError('A customer account is required.');
    const input = parseTransfer(args);
    const payload = payloadOf(input);
    // An unverified outcome is settled by the bank before anything else happens to the intent.
    await reconcileIntent({ userId: ctx.userId, intentId: ctx.intentId });
    const previous = intents.byId(ctx.intentId);
    assertSameIntent(previous, ctx.userId, payload);
    // A completed intent is a verified fact: answer from the record instead of asking the bank.
    if (previous?.status === 'completed') return storedOutcome(previous, input);
    // A dispatch in flight (or one reconcile could not settle yet) owns the intent: no proposal.
    if (previous?.status === 'processing')
      throw new ConflictError('This transfer is already being sent.');
    intents.insertIfAbsent({
      id: ctx.intentId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      payload,
      status: 'created',
      bankReference: null,
      operationId: null,
      error: null,
      createdAt: clock.now().toISOString(),
    });
    let permission;
    try {
      permission = await authorizeTransfer(ctx, input);
    } catch (e) {
      // Another writer moved the intent while it was being authorised: answer what it says.
      if (!(e instanceof IllegalTransitionError)) throw e;
      return storedOutcome(intents.byId(ctx.intentId)!, input);
    }
    // `null`: the approval was consumed and the intent is already `processing`, owned by this call.
    if (permission) return permission;
    events.record(ctx, 'transfer.started', {
      status: 'processing',
      input,
      intentId: ctx.intentId,
    });
    let operation: Operation;
    try {
      operation = await dispatchTransfer(ctx, input);
    } catch (e) {
      // A 5xx or a lost response does not prove the bank rejected it: it may have committed.
      const { status, error } = dispatchOutcome(e);
      const stored = record(ctx.intentId, input, status, { error });
      if (stored) return stored;
      events.record(ctx, `transfer.${status}`, { status, error, intentId: ctx.intentId });
      return { status, error, intentId: ctx.intentId };
    }
    const stored = record(ctx.intentId, input, 'completed', {
      operation_id: operation.id,
      error: null,
    });
    if (stored) return stored;
    events.record(ctx, 'transfer.completed', {
      status: 'completed',
      operation,
      intentId: ctx.intentId,
    });
    return { status: 'completed', operation, intentId: ctx.intentId };
  };
}
export type TransferMoney = ReturnType<typeof makeTransferMoney>;
