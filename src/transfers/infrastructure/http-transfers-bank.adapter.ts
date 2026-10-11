import * as bank from '../../platform/bank/bank';
import { withBankFailure } from '../../platform/bank/with-bank-failure';
import type { TransfersBank } from '../application/ports/transfers-bank';
/** The bank over HTTP (`platform/bank`), every call signed for the server-known actor. */
export const httpTransfersBank: TransfersBank = {
  accounts: (userId) => withBankFailure(bank.accounts(userId)),
  contacts: (userId) => withBankFailure(bank.contacts(userId)),
  movements: (userId) => withBankFailure(bank.movements(userId)),
  transfer: (userId, input, reference) => withBankFailure(bank.transfer(userId, input, reference)),
  operation: (userId, reference) => withBankFailure(bank.operation(userId, reference)),
};
