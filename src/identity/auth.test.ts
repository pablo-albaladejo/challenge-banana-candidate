import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, actor, sameOrigin, sessionToken } from './auth';
import { customers } from '../../tests/fixtures/world';
const withCookie = (cookie: string) =>
  new Request('http://localhost/api', { headers: { cookie, 'x-user-id': customers.bruno } });
const withOrigin = (origin: string) =>
  new Request('http://localhost/api', { headers: { host: '127.0.0.1:3000', origin } });
describe('actor', () => {
  it('should resolve the actor from the signed session, ignoring identity headers', () => {
    // Arrange
    const request = withCookie(`banana_actor=${sessionToken(customers.lucia)}`);
    // Act
    const person = actor(request);
    // Assert
    assert.equal(person.id, customers.lucia);
  });
  it('should reject a forged session signature', () => {
    // Arrange
    const request = withCookie(`banana_actor=${customers.bruno}.invalid`);
    // Act & Assert
    assert.throws(() => actor(request));
  });
  it('should reject a request without a session', () => {
    // Arrange
    const request = withCookie('');
    // Act & Assert
    assert.throws(() => actor(request));
  });
});
describe('sameOrigin', () => {
  it('should accept a request whose origin matches the host', () => {
    // Arrange
    const request = withOrigin('http://127.0.0.1:3000');
    // Act & Assert
    assert.doesNotThrow(() => sameOrigin(request));
  });
  it('should reject a request from a different origin', () => {
    // Arrange
    const request = withOrigin('https://example.com');
    // Act & Assert
    assert.throws(() => sameOrigin(request));
  });
  it('should reject a browser request marked cross-site even without an origin header', () => {
    // Arrange
    const request = new Request('http://localhost/api', {
      headers: { host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' },
    });
    // Act & Assert
    assert.throws(
      () => sameOrigin(request),
      (e) => e instanceof HttpError && e.status === 403,
    );
  });
  it('should accept a non-browser client that sends neither origin nor fetch metadata', () => {
    // Arrange
    const request = new Request('http://localhost/api', { headers: { host: '127.0.0.1:3000' } });
    // Act & Assert
    assert.doesNotThrow(() => sameOrigin(request));
  });
});
