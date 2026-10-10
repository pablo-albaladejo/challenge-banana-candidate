import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { httpStatusOf, toErrorResponse, toLegacyError } from './errors';
import { HttpError } from './http-error';
import { BankError } from '../bank/client';
import { MissingOpenAIKeyError } from '../model/gateway';
import {
  BadRequestError,
  DomainError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
} from '../../shared/domain/errors';
import { BankFailure } from '../../shared/domain/bank-failure';

/** A domain error whose kind has no HTTP status of its own (a `bank` kind that is not a BankFailure). */
class UnmappedError extends DomainError {
  readonly kind = 'bank';
}

describe('toErrorResponse', () => {
  const logged: unknown[][] = [];
  const original = console.error;
  beforeEach(() => {
    logged.length = 0;
    console.error = (...args: unknown[]) => logged.push(args);
  });
  afterEach(() => {
    console.error = original;
  });

  it('should answer a missing OpenAI key with 503 and its code', async () => {
    // Arrange
    const error = new MissingOpenAIKeyError();
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: error.message,
      code: 'missing_openai_api_key',
    });
  });

  it('should answer an HttpError with its own status and message', async () => {
    // Arrange
    const error = new HttpError(404, 'Route not found.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Route not found.' });
  });

  it('should answer a BankError with its own status and message', async () => {
    // Arrange
    const error = new BankError(409, 'Insufficient funds.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Insufficient funds.' });
  });

  it('should answer a validation error as invalid request data', async () => {
    // Arrange
    const error = z.object({ a: z.string() }).safeParse({}).error;
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid request data.' });
  });

  it('should answer malformed JSON as invalid request data', async () => {
    // Arrange
    const error = new SyntaxError('Unexpected end of JSON input');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid request data.' });
  });

  it('should answer any other error with a generic 500 and log only its name', async () => {
    // Arrange
    const error = new TypeError('secret detail');
    // Act
    const response = toErrorResponse(error, 'req-1');
    // Assert
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'The request could not be completed. Check the service and configuration.',
    });
    assert.deepEqual(logged, [['app_request_failed', 'TypeError']]);
  });

  it('should log a thrown non-error as unknown', () => {
    // Arrange
    const thrown = 'boom';
    // Act
    const response = toErrorResponse(thrown);
    // Assert
    assert.equal(response.status, 500);
    assert.deepEqual(logged, [['app_request_failed', 'unknown']]);
  });

  it('should answer a NotFoundError with 404 and its message', async () => {
    // Arrange
    const error = new NotFoundError('Case not found.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Case not found.' });
  });

  it('should answer a ConflictError with 409 and its message', async () => {
    // Arrange
    const error = new ConflictError('This transfer is already being sent.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'This transfer is already being sent.' });
  });

  it('should answer a ForbiddenError with 403 and its message', async () => {
    // Arrange
    const error = new ForbiddenError('Operator role required.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Operator role required.' });
  });

  it('should answer a BadRequestError with 400 and its message', async () => {
    // Arrange
    const error = new BadRequestError('Unknown person.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Unknown person.' });
  });

  it('should answer an UnavailableError with 502 and its message', async () => {
    // Arrange
    const error = new UnavailableError(
      'The AI provider returned 429. Check permissions and quota.',
    );
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'The AI provider returned 429. Check permissions and quota.',
    });
  });

  it('should answer a BankFailure with the bank status and message', async () => {
    // Arrange
    const error = new BankFailure('unreachable', 504, 'No response received from the bank.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: 'No response received from the bank.' });
  });

  it('should answer a domain error of an unmapped kind with 500 and its message', async () => {
    // Arrange
    const error = new UnmappedError('Something the kinds do not cover.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Something the kinds do not cover.' });
  });

  it('should keep no-store on error responses', () => {
    // Arrange
    const error = new HttpError(403, 'Origin not allowed.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

describe('httpStatusOf', () => {
  it('should map each domain error kind to its HTTP status', () => {
    // Arrange
    const errors = [
      new NotFoundError('x'),
      new ConflictError('x'),
      new ForbiddenError('x'),
      new BadRequestError('x'),
      new UnavailableError('x'),
    ];
    // Act
    const statuses = errors.map(httpStatusOf);
    // Assert
    assert.deepEqual(statuses, [404, 409, 403, 400, 502]);
  });

  it('should keep the bank status of a BankFailure', () => {
    // Arrange
    const error = new BankFailure('rejected', 422, 'Invalid transfer.');
    // Act
    const status = httpStatusOf(error);
    // Assert
    assert.equal(status, 422);
  });

  it('should give the own status of an HttpError and a BankError', () => {
    // Arrange
    const errors = [new HttpError(401, 'Invalid session.'), new BankError(504, 'x')];
    // Act
    const statuses = errors.map(httpStatusOf);
    // Assert
    assert.deepEqual(statuses, [401, 504]);
  });

  it('should give no status for any other value', () => {
    // Arrange
    const values = [new Error('x'), 'boom', { status: 500 }];
    // Act
    const statuses = values.map(httpStatusOf);
    // Assert
    assert.deepEqual(statuses, [undefined, undefined, undefined]);
  });
});

describe('toLegacyError', () => {
  it('should turn a BankFailure into a BankError with the same status and message', () => {
    // Arrange
    const failure = new BankFailure('notFound', 404, 'Operation not found.');
    // Act
    const legacy = toLegacyError(failure);
    // Assert
    assert.ok(legacy instanceof BankError);
    assert.deepEqual([legacy.status, legacy.message], [404, 'Operation not found.']);
  });

  it('should turn any other domain error into an HttpError with its status and message', () => {
    // Arrange
    const error = new ConflictError('This intent belongs to a different payload.');
    // Act
    const legacy = toLegacyError(error);
    // Assert
    assert.ok(legacy instanceof HttpError);
    assert.deepEqual(
      [legacy.status, legacy.message],
      [409, 'This intent belongs to a different payload.'],
    );
  });

  it('should turn a domain error of an unmapped kind into an HttpError with status 500', () => {
    // Arrange
    const error = new UnmappedError('Something the kinds do not cover.');
    // Act
    const legacy = toLegacyError(error);
    // Assert
    assert.ok(legacy instanceof HttpError);
    assert.deepEqual([legacy.status, legacy.message], [500, 'Something the kinds do not cover.']);
  });

  it('should keep the original domain error as the cause of the legacy error', () => {
    // Arrange
    const failure = new BankFailure('unreachable', 504, 'No response received from the bank.');
    const error = new NotFoundError('Intent not found.');
    // Act
    const legacy = [failure, error].map(toLegacyError) as Error[];
    // Assert
    assert.deepEqual(
      legacy.map((value) => value.cause),
      [failure, error],
    );
  });

  it('should return any other value as the same reference', () => {
    // Arrange
    const values = [new HttpError(403, 'x'), new BankError(504, 'x'), new Error('x'), 'boom'];
    // Act
    const legacy = values.map(toLegacyError);
    // Assert
    assert.ok(legacy.every((value, i) => value === values[i]));
  });
});
