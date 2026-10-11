import type { TransferInput } from '../../../types';
/** A transfer intent of the case conversation, its payload parsed. */
export type CaseIntent = {
  id: string;
  status: string;
  bank_reference: string | null;
  payload: TransferInput;
  created_at: string;
};
/** The transfers of a case. Wired to `transfers().getConversationTransfers`. */
export type ConversationTransfers = {
  /**
   * The conversation's intents, oldest first, after every unsettled one was checked with the bank
   * as `userId` (the case's customer).
   */
  reconcileAndList(userId: string, conversationId: string): Promise<CaseIntent[]>;
  /** Checks one intent with the bank; a `processing` one only once it is stale. */
  reconcile(userId: string, intentId: string): Promise<unknown>;
  /** The bank reference of every intent of the customer, any conversation. */
  customerIntents(userId: string): { id: string; bank_reference: string | null }[];
};
