import type { Operation } from '../../../types';
/** What the bank holds for a customer, asked by an operator. */
export type OperatorBank = {
  /** The customer's operations, signed as `operatorId`; rejects when the bank cannot answer. */
  customer(operatorId: string, customerId: string): Promise<{ operations: Operation[] }>;
};
