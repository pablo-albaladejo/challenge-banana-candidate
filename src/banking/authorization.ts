import { randomUUID } from 'node:crypto';
import { bankRequest } from './client';
import { HttpError } from '../auth';
import { appDb } from '../db';
import type { Account, ActionResult, ToolContext, TransferInput } from '../types';
const APPROVAL_TTL_MS = 10 * 60 * 1000;
type ApprovalRow = { id: string; payload: string; expires_at: string };
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
  const db = appDb(),
    now = new Date().toISOString(),
    payload = JSON.stringify(input);
  if (ctx.approvalId) {
    const consumed = db
      .prepare(
        'UPDATE approvals SET consumed_at=? WHERE id=? AND user_id=? AND intent_id=? AND payload=? AND consumed_at IS NULL AND expires_at>?',
      )
      .run(now, ctx.approvalId, ctx.userId, ctx.intentId, payload, now);
    if (consumed.changes !== 1)
      throw new HttpError(409, 'This proposal has expired or was already used.');
    return null;
  }
  let approval = db
    .prepare(
      'SELECT id,payload,expires_at FROM approvals WHERE intent_id=? AND user_id=? AND consumed_at IS NULL AND expires_at>?',
    )
    .get(ctx.intentId, ctx.userId, now) as ApprovalRow | undefined;
  if (!approval) {
    approval = {
      id: randomUUID(),
      payload,
      expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
    };
    db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,NULL)').run(
      approval.id,
      ctx.userId,
      ctx.intentId,
      approval.payload,
      approval.expires_at,
    );
  }
  db.prepare('UPDATE intents SET status=? WHERE id=?').run('requires_confirmation', ctx.intentId);
  return {
    status: 'requires_confirmation',
    approval: { id: approval.id, payload: input, expiresAt: approval.expires_at },
    intentId: ctx.intentId,
  };
}
