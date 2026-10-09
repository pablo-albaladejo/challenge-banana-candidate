import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { match, type Route } from './router';

const table = (...routes: [Route<string>['method'], string][]): Route<string>[] =>
  routes.map(([method, pattern]) => ({ method, pattern, handler: `${method} ${pattern}` }));

describe('match', () => {
  it('should match a literal path for its method', () => {
    // Arrange
    const routes = table(['GET', 'health']);
    // Act
    const result = match(routes, 'GET', ['health']);
    // Assert
    assert.deepEqual(result, { handler: 'GET health', params: {}, rest: [] });
  });

  it('should capture a named parameter', () => {
    // Arrange
    const routes = table(['GET', 'incidents/:id']);
    // Act
    const result = match(routes, 'GET', ['incidents', 'case-1']);
    // Assert
    assert.deepEqual(result?.params, { id: 'case-1' });
  });

  it('should capture trailing segments into rest', () => {
    // Arrange
    const routes = table(['POST', 'approvals/:id/confirm/*rest']);
    // Act
    const result = match(routes, 'POST', ['approvals', 'a-1', 'confirm', 'x', 'y']);
    // Assert
    assert.deepEqual(result, {
      handler: 'POST approvals/:id/confirm/*rest',
      params: { id: 'a-1' },
      rest: ['x', 'y'],
    });
  });

  it('should match a trailing rest with no extra segments', () => {
    // Arrange
    const routes = table(['GET', 'documents/:id/*rest']);
    // Act
    const result = match(routes, 'GET', ['documents', 'd-1']);
    // Assert
    assert.deepEqual(result?.rest, []);
  });

  it('should require every named parameter to be present', () => {
    // Arrange
    const routes = table(['GET', 'documents/:id/*rest']);
    // Act
    const result = match(routes, 'GET', ['documents']);
    // Assert
    assert.equal(result, null);
  });

  it('should match a route of any method for GET and POST', () => {
    // Arrange
    const routes = table(['ANY', 'incidents']);
    // Act
    const get = match(routes, 'GET', ['incidents']);
    const post = match(routes, 'POST', ['incidents']);
    // Assert
    assert.equal(get?.handler, 'ANY incidents');
    assert.equal(post?.handler, 'ANY incidents');
  });

  it('should skip a route registered for another method', () => {
    // Arrange
    const routes = table(['POST', 'actions']);
    // Act
    const result = match(routes, 'GET', ['actions']);
    // Assert
    assert.equal(result, null);
  });

  it('should reject extra segments on a route without rest', () => {
    // Arrange
    const routes = table(['ANY', 'health']);
    // Act
    const result = match(routes, 'GET', ['health', 'x']);
    // Assert
    assert.equal(result, null);
  });

  it('should return the first matching route in table order', () => {
    // Arrange
    const routes = table(
      ['POST', 'conversations/:id/messages/*rest'],
      ['ANY', 'conversations/:id/*rest'],
    );
    // Act
    const post = match(routes, 'POST', ['conversations', 'c-1', 'messages']);
    const get = match(routes, 'GET', ['conversations', 'c-1', 'messages']);
    // Assert
    assert.equal(post?.handler, 'POST conversations/:id/messages/*rest');
    assert.equal(get?.handler, 'ANY conversations/:id/*rest');
  });

  it('should return null when no route matches', () => {
    // Arrange
    const routes = table(['ANY', 'health'], ['ANY', 'people']);
    // Act
    const result = match(routes, 'GET', ['does-not-exist']);
    // Assert
    assert.equal(result, null);
  });
});
