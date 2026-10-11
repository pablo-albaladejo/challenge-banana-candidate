import type { Operation } from '../../../types';
/** What the bank holds for a customer. Every method rejects with `BankFailure` when the bank cannot answer. */
export type OperatorBank = {
  /** The customer's accounts and operations, signed as `operatorId`. */
  customer(
    operatorId: string,
    customerId: string,
  ): Promise<{ accounts: { id: string; label: string }[]; operations: Operation[] }>;
  /** The accounts the customer can pay, with their holders' names (the server's credential). */
  contactsOf(customerId: string): Promise<{ id: string; name?: string }[]>;
  /** The customer's ledger movements (the server's credential): the salary a fee waiver reads. */
  movementsOf(
    customerId: string,
  ): Promise<
    { id: string; accountId: string; amountCents: number; description: string; createdAt: string }[]
  >;
};
