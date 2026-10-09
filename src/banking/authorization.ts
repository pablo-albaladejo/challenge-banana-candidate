import { randomUUID } from 'node:crypto';
import { bankRequest } from './client';
import { HttpError } from '../auth';
import { consumeApproval, insertApproval, liveApprovalFor } from '../persistence/approvals';
import { updateIntent } from '../persistence/intents';
import type { Account, ActionResult, ToolContext, TransferInput } from '../types';
const APPROVAL_TTL_MS = 10 * 60 * 1000;
/**
 * Money only moves after the customer reviews amount, source and destination: without an approval
 * the intent gets a pending proposal; with one, the proposal is consumed atomically, once.
 */
export async function authorizeTransfer(
  ctx: ToolContext,
  input: TransferInput,
): Promise<ActionResult | null> {
  const accounts = await bankRequest<Account[]>(ctx.userId, '/v1/accounts');
  if (!accounts.some((a) => a.id === input.fromAccountId))
    throw new HttpError(403, 'This account does not belong to this person.');
  const contacts = await bankRequest<{ id: string }[]>(ctx.userId, '/v1/contacts');
  const destinations = [...accounts.map((a) => a.id), ...contacts.map((c) => c.id)];
  if (!destinations.includes(input.toAccountId))
    throw new HttpError(400, 'The destination account does not exist.');
  const now = new Date().toISOString(),
    payload = JSON.stringify(input);
  if (ctx.approvalId) {
    const consumed = consumeApproval({
      id: ctx.approvalId,
      userId: ctx.userId,
      intentId: ctx.intentId,
      payload,
      now,
    });
    if (consumed !== 1) throw new HttpError(409, 'This proposal has expired or was already used.');
    return null;
  }
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
  updateIntent(ctx.intentId, { status: 'requires_confirmation' });
  return {
    status: 'requires_confirmation',
    approval: { id: approval.id, payload: input, expiresAt: approval.expires_at },
    intentId: ctx.intentId,
  };
}
