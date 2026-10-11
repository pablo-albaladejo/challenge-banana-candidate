import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api';

// The browser's fetch is replaced per case; the server answer is what the page reacts to.
const answer = (t: TestContext, status: number, body: unknown) =>
  t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));

describe('api', () => {
  it('should return the parsed body of a successful request', async (t) => {
    // Arrange
    answer(t, 200, [{ id: 'lucia' }]);
    // Act
    const result = await api('people');
    // Assert
    assert.deepEqual(result, [{ id: 'lucia' }]);
  });

  it("should reject with the server's error and the response status", async (t) => {
    // Arrange
    answer(t, 404, { error: 'Route not found.' });
    // Act & Assert
    await assert.rejects(api('people'), { message: 'Route not found.', status: 404 });
  });
});
