import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wireIdentity } from '../../entry-points/dependencies';
import { hmacSessionTokens } from '../../infrastructure/hmac-session-tokens';
import { BadRequestError } from '../../../shared/domain/errors';
import { customers, unknown } from '../../../../tests/fixtures/world';

describe('StartSession', () => {
  it('should return the selected person with their signed token', () => {
    // Arrange
    const app = wireIdentity();
    // Act
    const session = app.startSession({ userId: customers.carla });
    // Assert
    assert.equal(session.person.id, customers.carla);
    assert.equal(session.token, hmacSessionTokens.issue(customers.carla));
  });
  it('should reject an unknown person as a bad request', () => {
    // Arrange
    const app = wireIdentity();
    // Act & Assert
    assert.throws(
      () => app.startSession({ userId: unknown.person }),
      (e) => e instanceof BadRequestError && e.message === 'Unknown person.',
    );
  });
});
