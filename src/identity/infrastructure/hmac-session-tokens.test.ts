import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHmac } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { hmacSessionTokens } from './hmac-session-tokens';
import { config } from '../../platform/config';
import { customers } from '../../../tests/fixtures/world';
describe('hmacSessionTokens', () => {
  it('should issue the person id followed by the hex HMAC-SHA256 of the id under the session secret', () => {
    // Arrange
    const expected = createHmac('sha256', config.sessionSecret)
      .update(customers.lucia)
      .digest('hex');
    // Act
    const token = hmacSessionTokens.issue(customers.lucia);
    // Assert
    assert.equal(token, `${customers.lucia}.${expected}`);
    assert.match(token, /^lucia\.[0-9a-f]{64}$/);
  });
  it('should issue the same token for the same person every time', () => {
    // Arrange
    // Act
    const tokens = [
      hmacSessionTokens.issue(customers.bruno),
      hmacSessionTokens.issue(customers.bruno),
    ];
    // Assert
    assert.equal(tokens[0], tokens[1]);
  });
  it('should sign with the session secret configured at call time', (t) => {
    // Arrange
    const original = config.sessionSecret;
    t.after(() => (config.sessionSecret = original));
    const before = hmacSessionTokens.issue(customers.lucia);
    // Act
    config.sessionSecret = 'rotated-session-secret';
    const after = hmacSessionTokens.issue(customers.lucia);
    const accepted = hmacSessionTokens.verify(after);
    const stale = hmacSessionTokens.verify(before);
    // Assert
    assert.notEqual(after, before);
    assert.equal(accepted, customers.lucia);
    assert.equal(stale, undefined);
  });
  it('should verify the signature with a constant-time comparison', (t) => {
    // Arrange
    const token = hmacSessionTokens.issue(customers.lucia);
    const spy = mock.method(crypto, 'timingSafeEqual');
    syncBuiltinESMExports();
    t.after(() => {
      spy.mock.restore();
      syncBuiltinESMExports();
    });
    // Act
    const verified = hmacSessionTokens.verify(token);
    // Assert
    assert.equal(verified, customers.lucia);
    assert.equal(spy.mock.callCount(), 1);
  });
});
