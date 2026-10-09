import { z } from 'zod';
import { insertIntentIfAbsent, intentById, updateIntent } from '../persistence/intents';
import { HttpError } from '../auth';
import { person } from '../people';
import { authorizeTransfer } from './authorization';
import { dispatchTransfer } from './dispatch';
import { BankError } from './client';
import { reconcileIntent } from './reconcile';
import { recordEvent } from '../telemetry';
import type { ActionResult, ToolContext } from '../types';
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
  if (previous?.status === 'completed')
    return {
      status: 'completed',
      operation: {
        ...input,
        id: previous.operation_id,
        userId: previous.user_id,
        reference: previous.bank_reference,
        status: 'completed',
      },
      intentId: ctx.intentId,
      replay: true,
    };
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
  const permission = await authorizeTransfer(ctx, input);
  if (permission) return permission;
  updateIntent(ctx.intentId, { status: 'processing' });
  recordEvent(ctx, 'transfer.started', { status: 'processing', input, intentId: ctx.intentId });
  try {
    const operation = await dispatchTransfer(ctx, input);
    updateIntent(ctx.intentId, { status: 'completed', operation_id: operation.id, error: null });
    recordEvent(ctx, 'transfer.completed', {
      status: 'completed',
      operation,
      intentId: ctx.intentId,
    });
    return { status: 'completed', operation, intentId: ctx.intentId };
  } catch (e) {
    // A 5xx or a lost response does not prove the bank rejected the transfer: it may have committed.
    const unconfirmed = e instanceof BankError && e.status >= 500;
    const status = unconfirmed ? 'unknown' : 'failed';
    const message = unconfirmed
      ? 'The bank did not confirm this transfer. It will be checked with the bank before any retry.'
      : e instanceof Error
        ? e.message
        : 'Transfer error';
    updateIntent(ctx.intentId, { status, error: message });
    recordEvent(ctx, `transfer.${status}`, { status, error: message, intentId: ctx.intentId });
    return { status, error: message, intentId: ctx.intentId };
  }
}
