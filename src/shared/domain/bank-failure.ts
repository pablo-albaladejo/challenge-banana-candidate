import { DomainError } from './errors';
/** What a failed bank call proves: nothing (`unreachable`, 5xx), no such record, or a refusal. */
export type BankFailureReason = 'unreachable' | 'rejected' | 'notFound';
/** A 5xx or a lost response does not prove the bank refused: it may have committed. */
export const bankFailureKind = (status: number): BankFailureReason =>
  status >= 500 ? 'unreachable' : status === 404 ? 'notFound' : 'rejected';
/** A failed bank call, keeping the bank's status and message as `BankError` did. */
export class BankFailure extends DomainError {
  readonly kind = 'bank';
  constructor(
    readonly reason: BankFailureReason,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Translates a bank client error at the adapter boundary. */
export const bankFailureFrom = (e: { status: number; message: string }) =>
  new BankFailure(bankFailureKind(e.status), e.status, e.message);
