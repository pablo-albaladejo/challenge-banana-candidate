import type { IntentRepository } from '../ports/intent-repository';
/**
 * The id and bank reference of every intent of a customer, in any conversation, newest first: what
 * support links a bank operation to. No payload, no status.
 */
export const makeListCustomerIntents =
  ({ intents }: { intents: IntentRepository }) =>
  ({ userId }: { userId: string }) =>
    intents.ofCustomer(userId).map(({ id, bank_reference }) => ({ id, bank_reference }));
