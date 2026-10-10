import { z } from 'zod';
import { insertIntentIfAbsent, intentById } from '../persistence/intents';
import { HttpError } from '../auth';
import { person } from '../people';
import { authorizeTransfer } from './authorization';
import { dispatchTransfer } from './dispatch';
import { BankError } from './client';
import { reconcileIntent } from './reconcile';
import { IllegalTransitionError, transition, type IntentStatus } from './intents';
import { recordEvent } from '../telemetry';
import type { ActionResult, Operation, ToolContext, TransferInput } from '../types';
import type { IntentFields } from '../persistence/intents';
export const transferSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amountCents: z.number().int().positive().max(10000000),
    concept: z.string().max(200),
  })
  .strict()
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: 'Source and destination accounts must differ.',
    path: ['toAccountId'],
  });
/** The intent's stored outcome as a result: what the record says, not what this caller expected. */
function storedOutcome(intentId: string, input: TransferInput): ActionResult {
  const row = intentById(intentId)!;
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
      intentId,
      replay: true,
    };
  return {
    status: row.status,
    error: 'This transfer changed state while it was being sent. Check its status before retrying.',
    intentId,
  };
}
/**
 * Writes a status edge. If another writer moved the intent first, the edge is illegal and nothing
 * is written: the caller answers with the stored outcome instead, so a booked operation is never
 * reported as an error.
 */
function record(
  intentId: string,
  input: TransferInput,
  to: IntentStatus,
  fields: Omit<IntentFields, 'status'> = {},
): ActionResult | null {
  try {
    transition(intentId, to, fields);
    return null;
  } catch (e) {
    if (!(e instanceof IllegalTransitionError)) throw e;
    return storedOutcome(intentId, input);
  }
}
export async function transferMoney(ctx: ToolContext, args: unknown): Promise<ActionResult> {
  if (person(ctx.userId)?.role !== 'customer')
    throw new HttpError(403, 'A customer account is required.');
  const input = transferSchema.parse(args);
  // An unverified outcome is settled by the bank before anything else happens to the intent.
  await reconcileIntent(ctx.userId, ctx.intentId);
  const previous = intentById(ctx.intentId);
  if (previous && (previous.user_id !== ctx.userId || previous.payload !== JSON.stringify(input)))
    throw new HttpError(409, 'This intent belongs to a different payload.');
  // A completed intent is a verified fact: answer from the record instead of asking the bank again.
  if (previous?.status === 'completed') return storedOutcome(ctx.intentId, input);
  // A dispatch in flight (or one reconcile could not settle yet) owns the intent: no new proposal.
  if (previous?.status === 'processing')
    throw new HttpError(409, 'This transfer is already being sent.');
  insertIntentIfAbsent({
    id: ctx.intentId,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    runId: ctx.runId,
    payload: JSON.stringify(input),
    status: 'created',
    bankReference: null,
    operationId: null,
    error: null,
    createdAt: new Date().toISOString(),
  });
  let permission;
  try {
    permission = await authorizeTransfer(ctx, input);
  } catch (e) {
    // Another writer moved the intent while it was being authorised: answer what the record says.
    if (!(e instanceof IllegalTransitionError)) throw e;
    return storedOutcome(ctx.intentId, input);
  }
  // `null`: the approval was consumed and the intent is already `processing`, owned by this call.
  if (permission) return permission;
  recordEvent(ctx, 'transfer.started', { status: 'processing', input, intentId: ctx.intentId });
  let operation: Operation;
  try {
    operation = await dispatchTransfer(ctx, input);
  } catch (e) {
    // A 5xx or a lost response does not prove the bank rejected the transfer: it may have committed.
    const unconfirmed = e instanceof BankError && e.status >= 500;
    const status = unconfirmed ? 'unknown' : 'failed';
    const message = unconfirmed
      ? 'The bank did not confirm this transfer. It will be checked with the bank before any retry.'
      : e instanceof Error
        ? e.message
        : 'Transfer error';
    const stored = record(ctx.intentId, input, status, { error: message });
    if (stored) return stored;
    recordEvent(ctx, `transfer.${status}`, { status, error: message, intentId: ctx.intentId });
    return { status, error: message, intentId: ctx.intentId };
  }
  const stored = record(ctx.intentId, input, 'completed', {
    operation_id: operation.id,
    error: null,
  });
  if (stored) return stored;
  recordEvent(ctx, 'transfer.completed', {
    status: 'completed',
    operation,
    intentId: ctx.intentId,
  });
  return { status: 'completed', operation, intentId: ctx.intentId };
}
