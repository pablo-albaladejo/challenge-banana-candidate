import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { json } from './respond';

describe('json', () => {
  it('should answer 200 with the JSON body and no-store by default', async () => {
    // Arrange
    const data = { ok: true };
    // Act
    const response = json(data);
    // Assert
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), data);
  });

  it('should merge extra headers with no-store', () => {
    // Arrange
    const headers = { 'Set-Cookie': 'banana_actor=x; Path=/' };
    // Act
    const response = json({}, 201, headers);
    // Assert
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), 'banana_actor=x; Path=/');
  });
});
