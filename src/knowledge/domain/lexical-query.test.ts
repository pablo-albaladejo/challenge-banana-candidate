import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lexicalQuery } from './lexical-query';

describe('lexicalQuery', () => {
  it('should quote each distinct word and OR them so no query character is FTS syntax', () => {
    // Arrange
    const query = 'Fees? fees, "NEAR" AND* (card)';
    // Act
    const expression = lexicalQuery(query);
    // Assert
    assert.equal(expression, '"fees" OR "near" OR "and" OR "card"');
  });

  it('should return no expression for a query without words', () => {
    // Arrange
    const query = '?! -- **';
    // Act
    const expression = lexicalQuery(query);
    // Assert
    assert.equal(expression, undefined);
  });
});
