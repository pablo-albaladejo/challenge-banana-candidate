// The frozen `src/auth` surface: the simulator and external callers import this path, so it must
// keep handing out the platform's `HttpError` class, `sign`/`equal`, and a session token the app
// accepts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as auth from './auth';
import { HttpError } from './platform/http/http-error';
import { equal, sign } from './platform/crypto';
import { config } from './platform/config';
import { operators } from '../tests/fixtures/world';

describe('frozen src/auth', () => {
  it('should hand out the platform HttpError class and crypto primitives', () => {
    // Arrange
    // Act
    const exported = { HttpError: auth.HttpError, sign: auth.sign, equal: auth.equal };
    // Assert
    assert.equal(exported.HttpError, HttpError);
    assert.equal(exported.sign, sign);
    assert.equal(exported.equal, equal);
  });
  it('should issue a session token that the frozen actor accepts', () => {
    // Arrange
    const token = auth.sessionToken(operators.marta);
    const request = new Request('http://localhost/api', {
      headers: { cookie: `banana_actor=${token}` },
    });
    // Act
    const person = auth.actor(request);
    // Assert
    assert.equal(token, `${operators.marta}.${sign(operators.marta, config.sessionSecret)}`);
    assert.equal(person.id, operators.marta);
  });
  it('should reject a cross-site request through the frozen sameOrigin', () => {
    // Arrange
    const request = new Request('http://localhost/api', {
      headers: { host: '127.0.0.1:3000', origin: 'https://example.com' },
    });
    // Act & Assert
    assert.throws(
      () => auth.sameOrigin(request),
      (e) => e instanceof HttpError && e.status === 403 && e.message === 'Origin not allowed.',
    );
  });
});
