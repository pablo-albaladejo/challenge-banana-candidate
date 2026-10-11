import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { caseGaps, operationsFor } from './case-evidence';

describe('caseGaps', () => {
  it('should report no gap when evidence is complete', () => {
    // Arrange
    const evidence = { hasEvents: true, bankReachable: true };
    // Act
    const gaps = caseGaps(evidence);
    // Assert
    assert.equal(gaps, null);
  });

  it('should name missing agent activity', () => {
    // Arrange
    const evidence = { hasEvents: false, bankReachable: true };
    // Act
    const gaps = caseGaps(evidence);
    // Assert
    assert.equal(gaps, 'No agent activity was recorded for this conversation.');
  });

  it('should name an unreachable bank', () => {
    // Arrange
    const evidence = { hasEvents: true, bankReachable: false };
    // Act
    const gaps = caseGaps(evidence);
    // Assert
    assert.equal(gaps, 'The bank could not be reached, so its operations are not shown.');
  });

  it('should join both gaps with one space', () => {
    // Arrange
    const evidence = { hasEvents: false, bankReachable: false };
    // Act
    const gaps = caseGaps(evidence);
    // Assert
    assert.equal(
      gaps,
      'No agent activity was recorded for this conversation. The bank could not be reached, so its operations are not shown.',
    );
  });
});

describe('operationsFor', () => {
  it('should keep only operations whose reference an intent holds', () => {
    // Arrange
    const operations = [{ reference: 'ref-a' }, { reference: 'ref-b' }, { reference: 'ref-c' }];
    const intents = [
      { bank_reference: 'ref-c' },
      { bank_reference: null },
      { bank_reference: 'ref-a' },
    ];
    // Act
    const kept = operationsFor(operations, intents);
    // Assert
    assert.deepEqual(kept, [{ reference: 'ref-a' }, { reference: 'ref-c' }]);
  });

  it('should keep no operation when no intent reached the bank', () => {
    // Arrange
    const operations = [{ reference: 'ref-a' }];
    const intents = [{ bank_reference: null }];
    // Act
    const kept = operationsFor(operations, intents);
    // Assert
    assert.deepEqual(kept, []);
  });
});
