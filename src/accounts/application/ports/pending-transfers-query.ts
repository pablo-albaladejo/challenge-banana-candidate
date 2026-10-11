import type { TransferInput } from '../../../types';
/** A transfer still worth showing, after its check with the bank. */
export type PendingTransfer = {
  id: string;
  status: string;
  payload: TransferInput;
  createdAt: string;
  operationId?: string;
};
/** A proposal still confirmable, its payload parsed; the row is passed through as it is. */
export type LiveProposal = { id: string; payload: TransferInput };
/**
 * The customer's transfers as the dashboard shows them. Wired to `transfers().listPendingTransfers`
 * and `transfers().listLiveProposals`.
 */
export type PendingTransfersQuery = {
  /** Up to 10 unsettled transfers of `userId`, each checked with the bank first. */
  pendingTransfers(userId: string): Promise<PendingTransfer[]>;
  /** The proposals of `userId` still confirmable now. */
  liveProposals(userId: string): LiveProposal[];
};
