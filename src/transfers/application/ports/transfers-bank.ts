import type { Account, Operation, TransferInput } from '../../../types';
/** The bank as transfers uses it. Every method rejects with a `BankFailure`, never the client error. */
export type TransfersBank = {
  accounts(userId: string): Promise<Account[]>;
  contacts(userId: string): Promise<{ id: string }[]>;
  /** Idempotent by actor + reference: reusing a reference replays the original operation. */
  transfer(userId: string, input: TransferInput, reference: string): Promise<Operation>;
  /** The actor's operation for a reference; a not-found `BankFailure` when the bank has none. */
  operation(userId: string, reference: string): Promise<Operation>;
};
