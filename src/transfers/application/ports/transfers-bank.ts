import type { Account, Operation, TransferInput } from '../../../types';
/** A ledger entry of one of the actor's accounts: negative cents leave it. No counterparty. */
export type Movement = {
  id: string;
  accountId: string;
  amountCents: number;
  createdAt: string;
};
/** The bank as transfers uses it. Every method rejects with a `BankFailure`, never the client error. */
export type TransfersBank = {
  accounts(userId: string): Promise<Account[]>;
  /** Destination accounts of other customers, with the holder's name when the bank knows it. */
  contacts(userId: string): Promise<{ id: string; name?: string }[]>;
  /** The actor's recent movements across all their accounts. */
  movements(userId: string): Promise<Movement[]>;
  /** Idempotent by actor + reference: reusing a reference replays the original operation. */
  transfer(userId: string, input: TransferInput, reference: string): Promise<Operation>;
  /** The actor's operation for a reference; a not-found `BankFailure` when the bank has none. */
  operation(userId: string, reference: string): Promise<Operation>;
};
