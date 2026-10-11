import type { TransfersBank } from '../ports/transfers-bank';
/** The customer's bank operation for a reference, as the bank reports it. */
export const makeGetOperationStatus =
  ({ bank }: { bank: TransfersBank }) =>
  ({ userId, reference }: { userId: string; reference: string }) =>
    bank.operation(userId, reference);
