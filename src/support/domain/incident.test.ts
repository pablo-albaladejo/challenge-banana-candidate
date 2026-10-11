import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireCase, requireOperator } from './incident';
import { ForbiddenError, NotFoundError } from '../../shared/domain/errors';

describe('requireOperator', () => {
  it('should let an operator through', () => {
    // Arrange
    const operator = { role: 'operator' as const };
    // Act & Assert
    assert.doesNotThrow(() => requireOperator(operator));
  });

  it('should refuse a customer with the operator role message', () => {
    // Arrange
    const customer = { role: 'customer' as const };
    // Act & Assert
    assert.throws(
      () => requireOperator(customer),
      (e: unknown) => e instanceof ForbiddenError && e.message === 'Operator role required.',
    );
  });

  it('should refuse an unknown person with the operator role message', () => {
    // Arrange
    const nobody = undefined;
    // Act & Assert
    assert.throws(
      () => requireOperator(nobody),
      (e: unknown) => e instanceof ForbiddenError && e.message === 'Operator role required.',
    );
  });
});

describe('requireCase', () => {
  it('should report a missing case as not found', () => {
    // Arrange
    const missing = undefined;
    // Act & Assert
    assert.throws(
      () => requireCase(missing),
      (e: unknown) => e instanceof NotFoundError && e.message === 'Case not found.',
    );
  });

  it('should return the case it was given', () => {
    // Arrange
    const incident = { id: 'case-1' };
    // Act
    const found = requireCase(incident);
    // Assert
    assert.equal(found, incident);
  });
});
