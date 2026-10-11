import type { TransferInput } from '../../../types';
/** A transfer intent of the case conversation, its payload parsed. */
export type CaseIntent = {
  id: string;
  status: string;
  bank_reference: string | null;
  payload: TransferInput;
};
/** The transfers of a case. Wired to `transfers().getConversationTransfers`. */
export type ConversationTransfers = {
  /**
   * The conversation's intents, oldest first, after every unsettled one was checked with the bank
   * as `userId` (the case's customer).
   */
  reconcileAndList(userId: string, conversationId: string): Promise<CaseIntent[]>;
};
