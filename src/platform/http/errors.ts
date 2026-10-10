import { z } from 'zod';
import { BankError } from '../bank/client';
import { MissingOpenAIKeyError } from '../model/gateway';
import { DomainError } from '../../shared/domain/errors';
import { BankFailure } from '../../shared/domain/bank-failure';
import { HttpError } from './http-error';
import { json } from './respond';
const domainStatus = {
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  bad_request: 400,
  unavailable: 502,
} satisfies Record<Exclude<DomainError['kind'], 'bank'>, number>;
/**
 * The HTTP status an error answers with: its own for `HttpError`, `BankError` and `BankFailure`,
 * the status of its kind for any other `DomainError`, and `undefined` for anything else (incl. a
 * `DomainError` whose kind has no status).
 */
export function httpStatusOf(e: unknown): number | undefined {
  if (e instanceof HttpError || e instanceof BankError || e instanceof BankFailure) return e.status;
  if (e instanceof DomainError && e.kind !== 'bank') return domainStatus[e.kind];
  return undefined;
}
/**
 * For the frozen-signature functions only: their callers still catch `HttpError` / `BankError`.
 * A `BankFailure` becomes a `BankError`, any other `DomainError` an `HttpError`, both with the same
 * status and message (500 for a kind with no status), and the original as `cause`; every other
 * value is returned as it is.
 */
export function toLegacyError(e: unknown): unknown {
  if (e instanceof BankFailure)
    return Object.assign(new BankError(e.status, e.message), { cause: e });
  if (e instanceof DomainError)
    return Object.assign(new HttpError(httpStatusOf(e) ?? 500, e.message), { cause: e });
  return e;
}
/**
 * Maps anything thrown while handling a request to its JSON response. Unknown errors log only
 * their name and answer a generic 500. `requestId` is accepted for later correlation (unused).
 */
export function toErrorResponse(e: unknown, requestId?: string) {
  void requestId;
  if (e instanceof MissingOpenAIKeyError)
    return json({ error: e.message, code: 'missing_openai_api_key' }, 503);
  if (e instanceof HttpError || e instanceof BankError) return json({ error: e.message }, e.status);
  if (e instanceof DomainError) return json({ error: e.message }, httpStatusOf(e) ?? 500);
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return json({ error: 'Invalid request data.' }, 400);
  console.error('app_request_failed', e instanceof Error ? e.name : 'unknown');
  return json(
    { error: 'The request could not be completed. Check the service and configuration.' },
    500,
  );
}
