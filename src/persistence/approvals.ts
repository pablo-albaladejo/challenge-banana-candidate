import { appDb } from '../db';
export type ApprovalRow = {
  id: string;
  user_id: string;
  intent_id: string;
  payload: string;
  expires_at: string;
  consumed_at: string | null;
};
export type NewApproval = {
  id: string;
  userId: string;
  intentId: string;
  payload: string;
  expiresAt: string;
};
export function insertApproval(a: NewApproval) {
  appDb()
    .prepare(
      'INSERT INTO approvals(id,user_id,intent_id,payload,expires_at,consumed_at) VALUES(?,?,?,?,?,NULL)',
    )
    .run(a.id, a.userId, a.intentId, a.payload, a.expiresAt);
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
  return appDb()
    .prepare(
      'UPDATE approvals SET consumed_at=? WHERE id=? AND user_id=? AND intent_id=? AND payload=? AND consumed_at IS NULL AND expires_at>?',
    )
    .run(a.now, a.id, a.userId, a.intentId, a.payload, a.now).changes;
}
/** The unconsumed, unexpired approval of an intent. */
export function liveApprovalFor(intentId: string, userId: string, now: string) {
  return appDb()
    .prepare(
      'SELECT id,payload,expires_at FROM approvals WHERE intent_id=? AND user_id=? AND consumed_at IS NULL AND expires_at>?',
    )
    .get(intentId, userId, now) as Pick<ApprovalRow, 'id' | 'payload' | 'expires_at'> | undefined;
}
/** Every unconsumed, unexpired approval of a customer. */
export function liveApprovalsOf(userId: string, now: string) {
  return appDb()
    .prepare('SELECT * FROM approvals WHERE user_id=? AND consumed_at IS NULL AND expires_at>?')
    .all(userId, now) as ApprovalRow[];
}
/** The approval, only when `userId` owns it. */
export function approvalOf(id: string, userId: string) {
  return appDb().prepare('SELECT * FROM approvals WHERE id=? AND user_id=?').get(id, userId) as
    ApprovalRow | undefined;
}
