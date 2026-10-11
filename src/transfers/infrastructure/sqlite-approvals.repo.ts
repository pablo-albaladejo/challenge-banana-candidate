import { statement } from '../../platform/db/statement';
import type { ApprovalRow, LiveApproval, NewApproval } from '../domain/approval';
import type { PreflightCheck } from '../domain/preflight';
import type { ApprovalRepository } from '../application/ports/approval-repository';
export type { ApprovalRow, LiveApproval, NewApproval };
const columns = 'id,user_id,intent_id,payload,expires_at,consumed_at';
/**
 * A row with its `checks` JSON parsed; NULL (rows older than migration 3) or unreadable JSON reads
 * as no checks, so one bad row never breaks the proposals list or the dashboard.
 */
function parsed<T extends { checks: string | null }>(row: T) {
  let checks: PreflightCheck[] = [];
  try {
    checks = row.checks === null ? [] : JSON.parse(row.checks);
  } catch {
    // Unreadable checks: shown as none.
  }
  return { ...row, checks };
}
export function insertApproval(a: NewApproval) {
  statement(
    'INSERT INTO approvals(id,user_id,intent_id,payload,expires_at,consumed_at,checks) VALUES(?,?,?,?,?,NULL,?)',
  ).run(a.id, a.userId, a.intentId, a.payload, a.expiresAt, JSON.stringify(a.checks));
}
/**
 * Consumes the approval atomically, only if it is live and matches user, intent and payload.
 * Returns the number of rows changed: 1 when consumed, 0 otherwise.
 */
export function consumeApproval(a: {
  id: string;
  userId: string;
  intentId: string;
  payload: string;
  now: string;
}) {
  return statement(
    'UPDATE approvals SET consumed_at=? WHERE id=? AND user_id=? AND intent_id=? AND payload=? AND consumed_at IS NULL AND expires_at>?',
  ).run(a.now, a.id, a.userId, a.intentId, a.payload, a.now).changes;
}
type Stored<T> = Omit<T, 'checks'> & { checks: string | null };
/** The unconsumed, unexpired approval of an intent, with its stored checks. */
export function liveApprovalFor(
  intentId: string,
  userId: string,
  now: string,
): Pick<LiveApproval, 'id' | 'payload' | 'expires_at' | 'checks'> | undefined {
  const row = statement(
    'SELECT id,payload,expires_at,checks FROM approvals WHERE intent_id=? AND user_id=? AND consumed_at IS NULL AND expires_at>?',
  ).get(intentId, userId, now) as
    Stored<Pick<LiveApproval, 'id' | 'payload' | 'expires_at' | 'checks'>> | undefined;
  return row && parsed(row);
}
/** Every unconsumed, unexpired approval of a customer, with its stored checks. */
export function liveApprovalsOf(userId: string, now: string): LiveApproval[] {
  return (
    statement(
      `SELECT ${columns},checks FROM approvals WHERE user_id=? AND consumed_at IS NULL AND expires_at>?`,
    ).all(userId, now) as Stored<LiveApproval>[]
  ).map(parsed);
}
/** The approval, only when `userId` owns it. */
export function approvalOf(id: string, userId: string) {
  return statement(`SELECT ${columns} FROM approvals WHERE id=? AND user_id=?`).get(id, userId) as
    ApprovalRow | undefined;
}
/** The approval repository over the app database. */
export const sqliteApprovals: ApprovalRepository = {
  insert: insertApproval,
  consume: consumeApproval,
  liveFor: liveApprovalFor,
  liveOf: liveApprovalsOf,
  ownedBy: approvalOf,
};
