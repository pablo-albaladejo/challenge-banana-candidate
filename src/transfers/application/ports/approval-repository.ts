import type { ApprovalRow, NewApproval } from '../../domain/approval';
export type ApprovalRepository = {
  insert(a: NewApproval): void;
  /** Consumes the live approval matching user, intent and payload; 1 when consumed, 0 otherwise. */
  consume(a: {
    id: string;
    userId: string;
    intentId: string;
    payload: string;
    now: string;
  }): number;
  /** The unconsumed, unexpired approval of an intent. */
  liveFor(
    intentId: string,
    userId: string,
    now: string,
  ): Pick<ApprovalRow, 'id' | 'payload' | 'expires_at'> | undefined;
  /** Every unconsumed, unexpired approval of a customer. */
  liveOf(userId: string, now: string): ApprovalRow[];
  /** The approval, only when `userId` owns it. */
  ownedBy(id: string, userId: string): ApprovalRow | undefined;
};
