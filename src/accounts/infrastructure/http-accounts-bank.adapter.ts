import * as bank from '../../platform/bank/bank';
import { withBankFailure } from '../../platform/bank/with-bank-failure';
import type { AccountsBank } from '../application/ports/accounts-bank';
/** The bank over HTTP (`platform/bank`), every call signed for the server-known actor. */
export const httpAccountsBank: AccountsBank = {
  accounts: (userId) => withBankFailure(bank.accounts(userId)),
  contacts: (userId) => withBankFailure(bank.contacts(userId)),
  movements: (userId) => withBankFailure(bank.movements(userId)),
};
