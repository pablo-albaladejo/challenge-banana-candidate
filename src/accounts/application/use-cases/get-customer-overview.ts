import type { AccountsBank } from '../ports/accounts-bank';
import type { PendingTransfersQuery } from '../ports/pending-transfers-query';

type Deps = { bank: AccountsBank; transfers: PendingTransfersQuery };
/**
 * A customer's dashboard: accounts, movements, contacts and the pending transfers in parallel
 * (one rejection fails the load), then the proposals live at that moment. Every read is for
 * `userId`; the caller passes the session actor and gates the role.
 */
export const makeGetCustomerOverview =
  ({ bank, transfers }: Deps) =>
  async ({ userId }: { userId: string }) => {
    const [accounts, movements, contacts, pending] = await Promise.all([
      bank.accounts(userId),
      bank.movements(userId),
      bank.contacts(userId),
      transfers.pendingTransfers(userId),
    ]);
    const approvals = transfers.liveProposals(userId);
    return { accounts, movements, contacts, approvals, pendingTransfers: pending };
  };
