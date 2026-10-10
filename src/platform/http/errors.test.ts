import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { toErrorResponse } from './errors';
import { HttpError } from './http-error';
import { BankError } from '../bank/client';
import { MissingOpenAIKeyError } from '../model/gateway';

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

  it('should keep no-store on error responses', () => {
    // Arrange
    const error = new HttpError(403, 'Origin not allowed.');
    // Act
    const response = toErrorResponse(error);
    // Assert
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});
