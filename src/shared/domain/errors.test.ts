import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BadRequestError,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
} from './errors';

const kinds = [
  [NotFoundError, 'not_found'],
  [ConflictError, 'conflict'],
  [ForbiddenError, 'forbidden'],
  [BadRequestError, 'bad_request'],
  [UnavailableError, 'unavailable'],
] as const;

describe('DomainError', () => {
  it('should keep the message it was given', () => {
    // Arrange
    const message = 'Conversation not found.';
    // Act
    const errors = kinds.map(([Kind]) => new Kind(message));
    // Assert
    assert.ok(errors.every((e) => e.message === message));
  });

  it('should name each error after its class', () => {
    // Arrange
    // Act
    const names = kinds.map(([Kind]) => new Kind('x').name);
    // Assert
    assert.deepEqual(names, [
      'NotFoundError',
      'ConflictError',
      'ForbiddenError',
      'BadRequestError',
      'UnavailableError',
    ]);
  });

  it('should give each class its own kind', () => {
    // Arrange
    // Act
    const actual = kinds.map(([Kind]) => new Kind('x').kind);
    // Assert
    assert.deepEqual(
      actual,
      kinds.map(([, kind]) => kind),
    );
  });

  it('should be an Error and a DomainError', () => {
    // Arrange
    // Act
    const errors = kinds.map(([Kind]) => new Kind('x'));
    // Assert
    assert.ok(errors.every((e) => e instanceof Error && e instanceof DomainError));
  });

  it('should carry no status, so a caught one is never taken for a provider failure', () => {
    // Arrange
    // Act
    const errors = kinds.map(([Kind]) => new Kind('x'));
    // Assert
    assert.ok(errors.every((e) => !('status' in e)));
  });
});
