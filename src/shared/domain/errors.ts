/**
 * A business rule was broken. It carries no HTTP status: `platform/http/errors.ts` maps each kind
 * to one (`httpStatusOf`), and it has no `status` field so `sendMessage` never takes a caught one
 * for a provider failure. The message is the exact text the customer or the model sees.
 */
export abstract class DomainError extends Error {
  abstract readonly kind:
    'not_found' | 'conflict' | 'forbidden' | 'bad_request' | 'unavailable' | 'bank';
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class NotFoundError extends DomainError {
  readonly kind = 'not_found';
}
export class ConflictError extends DomainError {
  readonly kind = 'conflict';
}
export class ForbiddenError extends DomainError {
  readonly kind = 'forbidden';
}
export class BadRequestError extends DomainError {
  readonly kind = 'bad_request';
}
export class UnavailableError extends DomainError {
  readonly kind = 'unavailable';
}
