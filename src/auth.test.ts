import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { actor, sameOrigin, sessionToken } from './auth';
const withCookie = (cookie: string) =>
  new Request('http://localhost/api', { headers: { cookie, 'x-user-id': 'bruno' } });
const withOrigin = (origin: string) =>
  new Request('http://localhost/api', { headers: { host: '127.0.0.1:3000', origin } });
describe('actor', () => {
  it('should resolve the actor from the signed session, ignoring identity headers', () => {
    // Arrange
    const request = withCookie(`banana_actor=${sessionToken('lucia')}`);
    // Act
    const person = actor(request);
    // Assert
    assert.equal(person.id, 'lucia');
  });
  it('should reject a forged session signature', () => {
    // Arrange
    const request = withCookie('banana_actor=bruno.invalid');
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
});
