import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HarnessFault, validateCases, type EvalCase } from './case';

const greeting = (id: string, overrides: Partial<EvalCase<string, string>> = {}) => ({
  id,
  input: () => 'Lucía',
  must: [{ label: 'greets by name', check: (out: string) => out.includes('Lucía') }],
  mustNot: [],
  ...overrides,
});

describe('validateCases', () => {
  it('should accept well-formed cases', () => {
    // Arrange
    const cases = [greeting('a'), greeting('b', { n: 5 })];
    // Act & Assert
    assert.doesNotThrow(() => validateCases(cases));
  });

  it('should reject duplicate case ids as a harness fault', () => {
    // Arrange
    const cases = [greeting('a'), greeting('a')];
    // Act & Assert
    assert.throws(() => validateCases(cases), HarnessFault);
  });

  it('should reject a case with no assertion as a harness fault', () => {
    // Arrange
    const cases = [greeting('a', { must: [], mustNot: [] })];
    // Act & Assert
    assert.throws(() => validateCases(cases), /no assertion/);
  });

  it('should reject a repeated assertion label within a case as a harness fault', () => {
    // Arrange
    const twice = { label: 'greets by name', check: () => true };
    const cases = [greeting('a', { must: [twice], mustNot: [twice] })];
    // Act & Assert
    assert.throws(() => validateCases(cases), /greets by name/);
  });

  it('should reject a per-case N that is not a positive integer as a harness fault', () => {
    // Arrange
    const cases = [greeting('a', { n: 0 })];
    // Act & Assert
    assert.throws(() => validateCases(cases), /positive integer/);
  });

  it('should reject an empty suite as a harness fault', () => {
    // Arrange
    const cases: EvalCase<string, string>[] = [];
    // Act & Assert
    assert.throws(() => validateCases(cases), HarnessFault);
  });
  it('should reject a case whose input builder is not a function as a harness fault', () => {
    // Arrange
    const cases = [greeting('a', { input: 'Lucía' as unknown as () => string })];
    // Act & Assert
    assert.throws(() => validateCases(cases), /input must be a function/);
  });

  it('should reject must or mustNot lists that are not arrays as a harness fault', () => {
    // Arrange
    const cases = [greeting('a', { mustNot: undefined as unknown as [] })];
    // Act & Assert
    assert.throws(() => validateCases(cases), /must and mustNot must be arrays/);
  });

  it('should reject an assertion whose check is not a function as a harness fault', () => {
    // Arrange
    const broken = { label: 'greets by name', check: 'Lucía' as unknown as () => boolean };
    const cases = [greeting('a', { must: [broken] })];
    // Act & Assert
    assert.throws(() => validateCases(cases), /check must be a function/);
  });

  it('should reject cases that are not an array as a harness fault', () => {
    // Arrange
    const cases = { a: greeting('a') } as unknown as EvalCase<string, string>[];
    // Act & Assert
    assert.throws(() => validateCases(cases), HarnessFault);
  });
});
