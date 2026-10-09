import { z } from 'zod';
import { appDb } from '../db';
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
  const input = transferSchema.parse(args),
    db = appDb();
  // An unverified outcome is settled by the bank before anything else happens to the intent.
  await reconcileIntent(ctx.userId, ctx.intentId);
  const previous = db
    .prepare('SELECT user_id,payload,status,bank_reference,operation_id FROM intents WHERE id=?')
    .get(ctx.intentId) as
    | {
        user_id: string;
        payload: string;
        status: string;
        bank_reference: string;
        operation_id: string;
      }
    | undefined;
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
  db.prepare('INSERT OR IGNORE INTO intents VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    ctx.intentId,
    ctx.userId,
    ctx.conversationId,
    ctx.runId,
    JSON.stringify(input),
    'created',
    null,
    null,
    null,
    new Date().toISOString(),
  );
  const permission = await authorizeTransfer(ctx, input);
  if (permission) return permission;
  db.prepare('UPDATE intents SET status=? WHERE id=?').run('processing', ctx.intentId);
  recordEvent(ctx, 'transfer.started', { status: 'processing', input, intentId: ctx.intentId });
  try {
    const operation = await dispatchTransfer(ctx, input);
    db.prepare('UPDATE intents SET status=?,operation_id=?,error=NULL WHERE id=?').run(
      'completed',
      operation.id,
      ctx.intentId,
    );
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
    db.prepare('UPDATE intents SET status=?,error=? WHERE id=?').run(status, message, ctx.intentId);
    recordEvent(ctx, `transfer.${status}`, { status, error: message, intentId: ctx.intentId });
    return { status, error: message, intentId: ctx.intentId };
  }
}
