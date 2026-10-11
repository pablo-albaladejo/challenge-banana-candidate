import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countVerified, unverifiable, type ClaimVerdict } from './claims';
import { statusClaimFactory } from '../../../tests/fixtures/factories';

describe('countVerified', () => {
  it('should count only verified verdicts, never an unverifiable one', () => {
    // Arrange
    const [a, b, c] = statusClaimFactory.buildList(3);
    const verdicts: ClaimVerdict[] = [
      { claimId: a.id, verdict: 'verified', reason: 'matches_operation', evidence: [] },
      unverifiable(b, 'bank_unreachable', 'The bank could not be reached.'),
      unverifiable(c, 'not_extracted', ''),
    ];
    // Act
    const count = countVerified(verdicts);
    // Assert
    assert.equal(count, 1);
  });
});
