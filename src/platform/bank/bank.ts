import { bankRequest } from './client';
import type { Account, Operation, TransferInput } from '../../types';
/** A destination account of another customer, as `GET /v1/contacts` lists it. */
export type Contact = Omit<Account, 'balanceCents'> & { name?: string };
export type Movement = {
  id: string;
  accountId: string;
  operationId: string | null;
  amountCents: number;
  description: string;
  createdAt: string;
};
export type CustomerRecord = { accounts: Account[]; operations: Operation[] };
/**
 * The bank port: one function per bank endpoint the app uses (docs/contracts.md), so no other
 * module builds a bank path. Every call is signed for the server-known actor by `bankRequest`.
 */
export const accounts = (userId: string) => bankRequest<Account[]>(userId, '/v1/accounts');
export const contacts = (userId: string) => bankRequest<Contact[]>(userId, '/v1/contacts');
export const movements = (userId: string) => bankRequest<Movement[]>(userId, '/v1/movements');
/** Idempotent by actor + reference: reusing a reference replays the original operation. */
export const transfer = (userId: string, input: TransferInput, reference: string) =>
  bankRequest<Operation>(userId, '/v1/transfers', 'POST', { ...input, reference });
/** The actor's operation for a reference; a `BankError(404)` when the bank has none. */
export const operation = (userId: string, reference: string) =>
  bankRequest<Operation>(userId, `/v1/operations/${encodeURIComponent(reference)}`);
/** A customer's accounts and operations; the bank answers it to operators only. */
export const operatorCustomer = (operatorId: string, customerId: string) =>
  bankRequest<CustomerRecord>(
    operatorId,
    `/v1/operator/customer?id=${encodeURIComponent(customerId)}`,
  );
