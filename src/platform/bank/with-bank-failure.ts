import { BankError } from './client';
import { bankFailureFrom } from '../../shared/domain/bank-failure';
/** For the bank adapters: a bank client error becomes a `BankFailure` at the boundary; anything else is rethrown. */
export async function withBankFailure<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    throw e instanceof BankError ? bankFailureFrom(e) : e;
  }
}
