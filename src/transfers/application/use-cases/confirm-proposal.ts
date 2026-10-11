import type { Ids } from '../../../shared/ports/ids';
import type { TransferMoney } from './transfer-money';
type Deps = { ids: Ids; transferMoney: TransferMoney };
export type ConfirmProposalCommand = {
  userId: string;
  approvalId: string;
  intentId: string;
  conversationId: string | null;
  /** The stored proposal payload (JSON), sent as the transfer arguments. */
  payload: string;
  /** The customer's "send anyway" past a matching pending transfer. */
  overridePendingIntentId?: string;
};
/** Confirms a proposal: the transfer runs again for its intent, with its approval, in a new run. */
export const makeConfirmProposal =
  ({ ids, transferMoney }: Deps) =>
  (c: ConfirmProposalCommand) =>
    transferMoney({
      userId: c.userId,
      conversationId: c.conversationId,
      runId: ids.uuid(),
      intentId: c.intentId,
      approvalId: c.approvalId,
      overridePendingIntentId: c.overridePendingIntentId,
      args: JSON.parse(c.payload),
    });
