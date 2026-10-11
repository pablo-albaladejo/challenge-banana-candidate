import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { allowedHosts, allowedHostsWarning, trustedHost } from './trusted-host';
import { HttpError } from './http-error';
import { config } from '../config';

const requestTo = (host?: string) =>
  new Request('http://127.0.0.1/api/health', host === undefined ? {} : { headers: { host } });
const unknownHost = (e: unknown) =>
  e instanceof HttpError && e.status === 421 && e.message === 'Unknown host.';

describe('allowedHosts', () => {
  it('should allow 127.0.0.1 and localhost on the app port by default', () => {
    // Arrange
    const appPort = faker.internet.port();
    // Act
    const hosts = allowedHosts({}, appPort);
    // Assert
    assert.deepEqual([...hosts], [`127.0.0.1:${appPort}`, `localhost:${appPort}`]);
  });

  it('should add every host listed in ALLOWED_HOSTS, trimmed and lower-cased, to the defaults', () => {
    // Arrange
    const env = { ALLOWED_HOSTS: ' Bank.Example , ,app.example:8443,' };
    // Act
    const hosts = allowedHosts(env, 3000);
    // Assert
    assert.deepEqual(
      [...hosts],
      ['127.0.0.1:3000', 'localhost:3000', 'bank.example', 'app.example:8443'],
    );
  });
});

describe('allowedHostsWarning', () => {
  for (const value of [undefined, '', ' , '])
    it(`should warn that only the loopback hosts are answered when ALLOWED_HOSTS is ${JSON.stringify(value)}`, () => {
      // Arrange
      const env = { ALLOWED_HOSTS: value };
      // Act
      const warning = allowedHostsWarning(env);
      // Assert
      assert.match(warning ?? '', /^ALLOWED_HOSTS is empty: /);
    });

  it('should name every entry with a scheme or a path', () => {
    // Arrange
    const env = { ALLOWED_HOSTS: 'https://bank.example, app.example/chat, ok.example' };
    // Act
    const warning = allowedHostsWarning(env);
    // Assert
    assert.equal(
      warning,
      'ALLOWED_HOSTS lists entries a Host header never carries (write host or host:port): https://bank.example, app.example/chat',
    );
  });

  it('should name an entry whose colon is not followed by a port', () => {
    // Arrange
    const env = { ALLOWED_HOSTS: 'app.example:https,bank.example:' };
    // Act
    const warning = allowedHostsWarning(env);
    // Assert
    assert.match(warning ?? '', /: app\.example:https, bank\.example:$/);
  });

  it('should stay silent for host names with or without a port', () => {
    // Arrange
    const env = { ALLOWED_HOSTS: 'Bank.Example, app.example:8443' };
    // Act
    const warning = allowedHostsWarning(env);
    // Assert
    assert.equal(warning, undefined);
  });
});

describe('trustedHost', () => {
  const saved = process.env.ALLOWED_HOSTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOWED_HOSTS;
    else process.env.ALLOWED_HOSTS = saved;
  });

  for (const host of ['127.0.0.1', 'localhost', 'LOCALHOST'])
    it(`should accept ${host} on the app port`, () => {
      // Arrange
      const request = requestTo(`${host}:${config.appPort}`);
      // Act & Assert
      assert.doesNotThrow(() => trustedHost(request));
    });

  it('should reject a rebinding host with 421 Unknown host', () => {
    // Arrange
    const request = requestTo(`${faker.internet.domainName()}:${config.appPort}`);
    // Act & Assert
    assert.throws(() => trustedHost(request), unknownHost);
  });

  it('should reject the loopback address on another port', () => {
    // Arrange
    const request = requestTo(`127.0.0.1:${config.appPort + 1}`);
    // Act & Assert
    assert.throws(() => trustedHost(request), unknownHost);
  });

  it('should reject a request with no Host header', () => {
    // Arrange
    const request = requestTo();
    // Act & Assert
    assert.throws(() => trustedHost(request), unknownHost);
  });

  it('should accept a host listed in ALLOWED_HOSTS at request time', () => {
    // Arrange
    const host = faker.internet.domainName();
    process.env.ALLOWED_HOSTS = host;
    const request = requestTo(host);
    // Act & Assert
    assert.doesNotThrow(() => trustedHost(request));
  });
});
