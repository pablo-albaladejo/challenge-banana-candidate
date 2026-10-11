import type { ApprovalRow, LiveApproval, NewApproval } from '../../domain/approval';
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
  /** The unconsumed, unexpired approval of an intent, with its stored checks. */
  liveFor(
    intentId: string,
    userId: string,
    now: string,
  ): Pick<LiveApproval, 'id' | 'payload' | 'expires_at' | 'checks'> | undefined;
  /** Every unconsumed, unexpired approval of a customer, with its stored checks. */
  liveOf(userId: string, now: string): LiveApproval[];
  /** The approval, only when `userId` owns it. */
  ownedBy(id: string, userId: string): ApprovalRow | undefined;
};
