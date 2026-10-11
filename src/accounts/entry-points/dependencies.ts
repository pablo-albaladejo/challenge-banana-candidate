import { transfers } from '../../transfers';
import { httpAccountsBank } from '../infrastructure/http-accounts-bank.adapter';
import { makeListAccounts } from '../application/use-cases/list-accounts';
import { makeGetCustomerOverview } from '../application/use-cases/get-customer-overview';
import type { AccountsBank } from '../application/ports/accounts-bank';
import type { PendingTransfersQuery } from '../application/ports/pending-transfers-query';
export type AccountsDeps = { bank: AccountsBank; transfers: PendingTransfersQuery };
/**
 * No overrides: no accounts use case reads the clock or ids (the pending transfers and the live
 * proposals read transfers' own clock), and the bank and transfers are always the real ones. No
 * `internals` either. The wired port calls `transfers()` lazily, inside the arrow, never at wiring.
 */
const defaults = (): AccountsDeps => ({
  bank: httpAccountsBank,
  transfers: {
    pendingTransfers: (userId) => transfers().listPendingTransfers({ userId }),
    liveProposals: (userId) => transfers().listLiveProposals({ userId }),
  },
});
export function wireAccounts() {
  const deps = defaults();
  return {
    listAccounts: makeListAccounts(deps),
    getCustomerOverview: makeGetCustomerOverview(deps),
  };
}
/** What index.ts exposes: the use cases. */
export type AccountsApp = ReturnType<typeof wireAccounts>;
let graph: AccountsApp | undefined;
export const accounts = (): AccountsApp => (graph ??= wireAccounts());
