import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lexicalQuery, lexicalSearch } from './lexical';
import { replaceChunks } from './store';
import { seedApp } from '../../server/seed';
import { chunkFactory } from '../../../tests/fixtures/factories';

const index = (...texts: string[]) => {
  const chunks = texts.map((text) => chunkFactory.build({ text }, { dimensions: 2 }));
  replaceChunks(chunks, { model: 'test-model', dimensions: 2 });
  return chunks;
};

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

describe('lexicalSearch', () => {
  beforeEach(() => seedApp());

  it('should rank first the chunk that matches the most query words', () => {
    // Arrange
    const [fee, travel] = index(
      'The Aurora card has a monthly fee of three euros.',
      'Aurora includes travel insurance.',
      'Cloud savings pay interest every quarter.',
    );
    // Act
    const results = lexicalSearch('What is the monthly fee of Aurora?');
    // Assert
    assert.deepEqual(
      results.map((r) => r.id),
      [fee.id, travel.id],
    );
    assert.ok(results[0].score > results[1].score);
  });

  it('should match word variants through stemming', () => {
    // Arrange
    const [transfers] = index('Transfers are executed instantly.', 'Cards expire yearly.');
    // Act
    const results = lexicalSearch('transfer execution');
    // Assert
    assert.deepEqual(
      results.map((r) => r.id),
      [transfers.id],
    );
  });

  it('should rebuild its index when the chunks change', () => {
    // Arrange
    index('A zephyr account for windy days.');
    const first = lexicalSearch('zephyr');
    // Act
    index('A plain account.');
    const second = lexicalSearch('zephyr');
    // Assert
    assert.equal(first.length, 1);
    assert.deepEqual(second, []);
  });

  it('should return every chunk field but the vector, with a numeric score', () => {
    // Arrange
    const [chunk] = index('Overdraft limits apply.');
    // Act
    const [result] = lexicalSearch('overdraft');
    // Assert
    const { vector, ...fields } = chunk;
    assert.equal(vector!.length, 2);
    assert.deepEqual({ ...result, score: 0 }, { ...fields, score: 0 });
    assert.equal(typeof result.score, 'number');
  });

  it('should treat FTS operators in the query as plain words', () => {
    // Arrange
    const [chunk] = index('Use NEAR for nearby branches.');
    // Act
    const results = lexicalSearch('NEAR( "branches" OR *');
    // Assert
    assert.equal(results[0].id, chunk.id);
  });
});
