import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BankFailure, bankFailureFrom, bankFailureKind } from './bank-failure';
import { DomainError } from './errors';

describe('bankFailureKind', () => {
  it('should classify 500, 502 and 504 as unreachable', () => {
    // Arrange
    const statuses = [500, 502, 504];
    // Act
    const kinds = statuses.map(bankFailureKind);
    // Assert
    assert.deepEqual(kinds, ['unreachable', 'unreachable', 'unreachable']);
  });

  it('should classify 404 as not found', () => {
    // Arrange
    const status = 404;
    // Act
    const kind = bankFailureKind(status);
    // Assert
    assert.equal(kind, 'notFound');
  });

  it('should classify 400, 403, 409 and 422 as rejected', () => {
    // Arrange
    const statuses = [400, 403, 409, 422];
    // Act
    const kinds = statuses.map(bankFailureKind);
    // Assert
    assert.deepEqual(kinds, ['rejected', 'rejected', 'rejected', 'rejected']);
  });
});

describe('BankFailure', () => {
  it('should keep the reason, status and message of the bank', () => {
    // Arrange
    // Act
    const failure = new BankFailure('rejected', 409, 'Insufficient funds.');
    // Assert
    assert.deepEqual(
      [failure.reason, failure.status, failure.message],
      ['rejected', 409, 'Insufficient funds.'],
    );
  });

  it('should be a domain error of kind bank named BankFailure', () => {
    // Arrange
    // Act
    const failure = new BankFailure('unreachable', 504, 'No response received from the bank.');
    // Assert
    assert.ok(failure instanceof DomainError);
    assert.equal(failure.kind, 'bank');
    assert.equal(failure.name, 'BankFailure');
  });
});

describe('bankFailureFrom', () => {
  it('should classify a bank error by its status and keep its status and message', () => {
    // Arrange
    const error = { status: 404, message: 'Operation not found.' };
    // Act
    const failure = bankFailureFrom(error);
    // Assert
    assert.ok(failure instanceof BankFailure);
    assert.deepEqual(
      [failure.reason, failure.status, failure.message],
      ['notFound', 404, 'Operation not found.'],
    );
  });
});
