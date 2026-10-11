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
/** How long a proposal stays confirmable. */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;
/** When a proposal made at `now` expires. */
export const approvalExpiresAt = (now: Date) =>
  new Date(now.getTime() + APPROVAL_TTL_MS).toISOString();
