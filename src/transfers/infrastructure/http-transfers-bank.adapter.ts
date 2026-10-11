import * as bank from '../../platform/bank/bank';
import { BankError } from '../../platform/bank/client';
import { bankFailureFrom } from '../../shared/domain/bank-failure';
import type { TransfersBank } from '../application/ports/transfers-bank';
/** A bank client error becomes a `BankFailure` here, at the boundary; anything else is rethrown. */
async function translated<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    throw e instanceof BankError ? bankFailureFrom(e) : e;
  }
}
/** The bank over HTTP (`platform/bank`), every call signed for the server-known actor. */
export const httpTransfersBank: TransfersBank = {
  accounts: (userId) => translated(bank.accounts(userId)),
  contacts: (userId) => translated(bank.contacts(userId)),
  movements: (userId) => translated(bank.movements(userId)),
  transfer: (userId, input, reference) => translated(bank.transfer(userId, input, reference)),
  operation: (userId, reference) => translated(bank.operation(userId, reference)),
};
