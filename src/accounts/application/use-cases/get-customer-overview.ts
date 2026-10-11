import type { Account, TransferInput } from '../../../types';
import type { AccountsBank, Contact } from '../ports/accounts-bank';
import type { PendingTransfersQuery } from '../ports/pending-transfers-query';

type Deps = { bank: AccountsBank; transfers: PendingTransfersQuery };
/**
 * One side of a transfer as the cards show it, never the internal account id (readiness P0-6).
 * `own`: true for the customer's account, false for a contact (another person), null when the bank
 * lists neither.
 */
export type TransferParty = {
  holder?: string;
  label: string;
  iban: string | null;
  own: boolean | null;
};
/** `ES91 ···· 0002`; null when the bank sent no IBAN or one too short to mask (8 chars or fewer). */
const masked = (iban: string | undefined) =>
  iban && iban.length > 8 ? `${iban.slice(0, 4)} ···· ${iban.slice(-4)}` : null;
/**
 * Names an account of a transfer from the customer's own accounts, then her contacts (with the
 * holder's name): its label and masked IBAN. An account the bank does not list is "Unknown account".
 */
function partyOf(id: string, accounts: Account[], contacts: Contact[]): TransferParty {
  const own = accounts.find((a) => a.id === id);
  if (own) return { label: own.label, iban: masked(own.iban), own: true };
  const contact = contacts.find((c) => c.id === id);
  if (!contact) return { label: 'Unknown account', iban: null, own: null };
  return {
    ...(contact.name ? { holder: contact.name } : {}),
    label: contact.label,
    iban: masked(contact.iban),
    own: false,
  };
}
/**
 * A customer's dashboard: accounts, movements, contacts and the pending transfers in parallel
 * (one rejection fails the load), then the proposals live at that moment. Every pending transfer and
 * proposal gets its `parties` named from those accounts and contacts (the stored payload is passed
 * through unchanged). Every read is for `userId`; the caller passes the session actor and gates the
 * role.
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
    const named = <T extends { payload: TransferInput }>(t: T) => ({
      ...t,
      parties: {
        from: partyOf(t.payload.fromAccountId, accounts, contacts),
        to: partyOf(t.payload.toAccountId, accounts, contacts),
      },
    });
    const approvals = transfers.liveProposals(userId).map(named);
    return { accounts, movements, contacts, approvals, pendingTransfers: pending.map(named) };
  };
