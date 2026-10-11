import type { AccountsBank } from '../ports/accounts-bank';

/** The customer's accounts and the accounts they can pay: two bank calls, accounts first. */
export const makeListAccounts =
  ({ bank }: { bank: AccountsBank }) =>
  async ({ userId }: { userId: string }) => ({
    accounts: await bank.accounts(userId),
    contacts: await bank.contacts(userId),
  });
