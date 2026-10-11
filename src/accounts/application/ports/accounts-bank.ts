import type { Account } from '../../../types';
/** A destination account of another customer, with the holder's name when the bank knows it. */
export type Contact = Omit<Account, 'balanceCents'> & { name?: string };
/** A ledger entry of one of the customer's accounts: negative cents leave it. */
export type Movement = {
  id: string;
  accountId: string;
  operationId: string | null;
  amountCents: number;
  description: string;
  createdAt: string;
};
/**
 * What the bank holds for a customer. Every call is signed as `userId`, so the bank answers with
 * that customer's data only. Every method rejects with a `BankFailure`, never the client error.
 */
export type AccountsBank = {
  accounts(userId: string): Promise<Account[]>;
  contacts(userId: string): Promise<Contact[]>;
  movements(userId: string): Promise<Movement[]>;
};
