import type { PreflightCheck } from './preflight';
/** An `approvals` row, without its `checks` column (see `LiveApproval`). */
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
  /** The pre-flight checks shown with the proposal, stored as JSON. */
  checks: PreflightCheck[];
};
/** A confirmable approval with its stored checks parsed (`[]` for rows older than migration 3). */
export type LiveApproval = ApprovalRow & { checks: PreflightCheck[] };
/** How long a proposal stays confirmable. */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;
/** When a proposal made at `now` expires. */
export const approvalExpiresAt = (now: Date) =>
  new Date(now.getTime() + APPROVAL_TTL_MS).toISOString();
