import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wireIdentity } from '../../entry-points/dependencies';
import { hmacSessionTokens } from '../../infrastructure/hmac-session-tokens';
import { people } from '../../infrastructure/people-roster';
import { customers, operators, unknown } from '../../../../tests/fixtures/world';

describe('VerifySession', () => {
  it('should return the roster person behind a validly signed token', () => {
    // Arrange
    const app = wireIdentity();
    const token = hmacSessionTokens.issue(operators.marta);
    // Act
    const found = app.verifySession({ token });
    // Assert
    assert.equal(
      found,
      people.find((p) => p.id === operators.marta),
    );
  });
  it('should resolve no person for a validly signed token of an unknown id', () => {
    // Arrange
    const app = wireIdentity();
    const token = hmacSessionTokens.issue(unknown.person);
    // Act
    const found = app.verifySession({ token });
    // Assert
    assert.equal(found, undefined);
  });
  it('should resolve no person for a token signed for someone else', () => {
    // Arrange
    const app = wireIdentity();
    const signature = hmacSessionTokens.issue(customers.lucia).split('.')[1];
    // Act
    const found = app.verifySession({ token: `${operators.pablo}.${signature}` });
    // Assert
    assert.equal(found, undefined);
  });
});
