import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { actor, sameOrigin } from './session-guard';
import { HttpError } from '../../../platform/http/http-error';
import { sessionToken } from '../legacy';
import { person } from '../../infrastructure/people-roster';
import { customers, operators, unknown } from '../../../../tests/fixtures/world';
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
describe('actor session checks', () => {
  const rejected = (status: number, message: string) => (e: unknown) =>
    e instanceof HttpError && e.status === status && e.message === message;
  it('should ask to select a person when no session cookie is among the cookies', () => {
    // Arrange
    const request = withCookie('theme=dark; other=1');
    // Act & Assert
    assert.throws(() => actor(request), rejected(401, 'Select a person to continue.'));
  });
  it('should ask to select a person when the session cookie is empty', () => {
    // Arrange
    const request = withCookie('banana_actor=');
    // Act & Assert
    assert.throws(() => actor(request), rejected(401, 'Select a person to continue.'));
  });
  it('should find the session cookie among other cookies', () => {
    // Arrange
    const request = withCookie(`theme=dark;  banana_actor=${sessionToken(customers.lucia)} ; x=1`);
    // Act
    const found = actor(request);
    // Assert
    assert.equal(found.id, customers.lucia);
  });
  it('should reject a validly signed session for an unknown person', () => {
    // Arrange
    const request = withCookie(`banana_actor=${sessionToken(unknown.person)}`);
    // Act & Assert
    assert.throws(() => actor(request), rejected(401, 'Invalid session.'));
  });
  it('should reject a session signed with another secret', () => {
    // Arrange
    const forged = createHmac('sha256', 'not-the-secret').update(customers.lucia).digest('hex');
    const request = withCookie(`banana_actor=${customers.lucia}.${forged}`);
    // Act & Assert
    assert.throws(() => actor(request), rejected(401, 'Invalid session.'));
  });
  it('should reject a session whose signature belongs to another person', () => {
    // Arrange
    const signature = sessionToken(customers.lucia).split('.')[1];
    const request = withCookie(`banana_actor=${operators.marta}.${signature}`);
    // Act & Assert
    assert.throws(() => actor(request), rejected(401, 'Invalid session.'));
  });
  it('should reject a session without a signature', () => {
    // Arrange
    const bare = withCookie(`banana_actor=${customers.lucia}`);
    const empty = withCookie(`banana_actor=${customers.lucia}.`);
    // Act & Assert
    assert.throws(() => actor(bare), rejected(401, 'Invalid session.'));
    assert.throws(() => actor(empty), rejected(401, 'Invalid session.'));
  });
  it('should take the person and role from the roster, not from the cookie', () => {
    // Arrange
    const request = withCookie(`banana_actor=${sessionToken(customers.lucia)}.operator`);
    // Act
    const found = actor(request);
    // Assert
    assert.deepEqual(found, person(customers.lucia));
    assert.equal(found.role, 'customer');
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
  it('should reject a same-host origin with a non-web scheme', () => {
    // Arrange
    const request = withOrigin('ftp://127.0.0.1:3000');
    // Act & Assert
    assert.throws(
      () => sameOrigin(request),
      (e) => e instanceof HttpError && e.status === 403 && e.message === 'Origin not allowed.',
    );
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
