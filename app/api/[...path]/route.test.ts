import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from './route';
import { seedApp } from '../../../src/seed';
import { sessionToken } from '../../../src/auth';
describe('POST /api/search', () => {
  it('should return actionable configuration guidance when the API key is missing', async () => {
    // Arrange
    seedApp();
    const request = new Request('http://localhost/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `banana_actor=${sessionToken('lucia')}`,
      },
      body: JSON.stringify({ query: `configuration-check-${Date.now()}` }),
    });
    // Act
    const response = await POST(request, { params: Promise.resolve({ path: ['search'] }) });
    // Assert
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, 'missing_openai_api_key');
    assert.match(result.error, /OPENAI_API_KEY/);
    assert.match(result.error, /restart/);
  });
});
