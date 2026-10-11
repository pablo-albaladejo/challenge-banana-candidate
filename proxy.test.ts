import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { proxy } from './proxy';
import { config } from './src/platform/config';

const pageRequest = (host: string) =>
  new Request(`http://127.0.0.1:${config.appPort}/`, { headers: { host } });

describe('proxy', () => {
  it('should let a page request to the app loopback host through to Next', () => {
    // Arrange
    const request = pageRequest(`localhost:${config.appPort}`);
    // Act
    const response = proxy(request);
    // Assert
    assert.equal(response, undefined);
  });

  it('should answer a page request from an unknown Host with 421 JSON and no store', async () => {
    // Arrange
    const request = pageRequest(`${faker.internet.domainName()}:${config.appPort}`);
    // Act
    const response = proxy(request);
    // Assert
    assert.equal(response?.status, 421);
    assert.equal(response?.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response?.json(), { error: 'Unknown host.' });
  });
});
