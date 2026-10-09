import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowedMethods, match, type Route } from './router';

const table = (...routes: [Route<string>['method'], string][]): Route<string>[] =>
  routes.map(([method, pattern]) => ({ method, pattern, handler: `${method} ${pattern}` }));

describe('match', () => {
  it('should match a literal path for its method', () => {
    // Arrange
    const routes = table(['GET', 'health']);
    // Act
    const result = match(routes, 'GET', ['health']);
    // Assert
    assert.deepEqual(result, { handler: 'GET health', params: {} });
  });

  it('should capture a named parameter', () => {
    // Arrange
    const routes = table(['GET', 'incidents/:id']);
    // Act
    const result = match(routes, 'GET', ['incidents', 'case-1']);
    // Assert
    assert.deepEqual(result?.params, { id: 'case-1' });
  });

  it('should reject extra segments beyond the pattern', () => {
    // Arrange
    const routes = table(['POST', 'approvals/:id/confirm']);
    // Act
    const result = match(routes, 'POST', ['approvals', 'a-1', 'confirm', 'x']);
    // Assert
    assert.equal(result, null);
  });

  it('should require every named parameter to be present', () => {
    // Arrange
    const routes = table(['GET', 'documents/:id']);
    // Act
    const result = match(routes, 'GET', ['documents']);
    // Assert
    assert.equal(result, null);
  });

  it('should match a GET and a POST route on the same path to their own handlers', () => {
    // Arrange
    const routes = table(['POST', 'conversations'], ['GET', 'conversations']);
    // Act
    const get = match(routes, 'GET', ['conversations']);
    const post = match(routes, 'POST', ['conversations']);
    // Assert
    assert.equal(get?.handler, 'GET conversations');
    assert.equal(post?.handler, 'POST conversations');
  });

  it('should match a HEAD request against a GET route', () => {
    // Arrange
    const routes = table(['GET', 'health']);
    // Act
    const result = match(routes, 'HEAD', ['health']);
    // Assert
    assert.equal(result?.handler, 'GET health');
  });

  it('should skip a route registered for another method', () => {
    // Arrange
    const routes = table(['POST', 'actions']);
    // Act
    const result = match(routes, 'GET', ['actions']);
    // Assert
    assert.equal(result, null);
  });

  it('should return the first matching route in table order', () => {
    // Arrange
    const routes = table(['GET', 'documents/:id'], ['GET', 'documents/latest']);
    // Act
    const result = match(routes, 'GET', ['documents', 'latest']);
    // Assert
    assert.deepEqual(result, { handler: 'GET documents/:id', params: { id: 'latest' } });
  });

  it('should return null when no route matches', () => {
    // Arrange
    const routes = table(['GET', 'health'], ['GET', 'people']);
    // Act
    const result = match(routes, 'GET', ['does-not-exist']);
    // Assert
    assert.equal(result, null);
  });
});

describe('allowedMethods', () => {
  it('should list the method of the route matching the path', () => {
    // Arrange
    const routes = table(['POST', 'actions'], ['POST', 'incidents/:id']);
    // Act
    const result = allowedMethods(routes, ['incidents', 'case-1']);
    // Assert
    assert.deepEqual(result, ['POST']);
  });

  it('should list HEAD alongside GET because HEAD is answered as GET', () => {
    // Arrange
    const routes = table(['POST', 'actions'], ['GET', 'incidents/:id']);
    // Act
    const result = allowedMethods(routes, ['incidents', 'case-1']);
    // Assert
    assert.deepEqual(result, ['GET', 'HEAD']);
  });

  it('should list each method once when several routes accept the path', () => {
    // Arrange
    const routes = table(['GET', 'documents/latest'], ['GET', 'documents/:id']);
    // Act
    const result = allowedMethods(routes, ['documents', 'latest']);
    // Assert
    assert.deepEqual(result, ['GET', 'HEAD']);
  });

  it('should list every method a path accepts in alphabetical order', () => {
    // Arrange
    const routes = table(['POST', 'conversations'], ['GET', 'conversations']);
    // Act
    const result = allowedMethods(routes, ['conversations']);
    // Assert
    assert.deepEqual(result, ['GET', 'HEAD', 'POST']);
  });

  it('should return no methods for an unknown path', () => {
    // Arrange
    const routes = table(['GET', 'health'], ['POST', 'actions']);
    // Act
    const result = allowedMethods(routes, ['does-not-exist']);
    // Assert
    assert.deepEqual(result, []);
  });

  it('should return no methods for a path with extra segments', () => {
    // Arrange
    const routes = table(['GET', 'documents/:id/chunks']);
    // Act
    const result = allowedMethods(routes, ['documents', 'd-1', 'chunks', 'x']);
    // Assert
    assert.deepEqual(result, []);
  });
});
