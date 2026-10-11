import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectProcedures } from './procedure-selection';

/** procedure-1 … procedure-12, v2 in force from 2026-09-01, as the seeded corpus holds them. */
const catalog = Array.from({ length: 12 }, (_, i) => ({
  id: `procedure-${i + 1}`,
  title: `Procedure ${i + 1}`,
  version: 2,
  validFrom: '2026-09-01',
  validTo: null,
}));

describe('selectProcedures', () => {
  it('should cite the procedures of the most severe findings first, at most three', () => {
    // Arrange
    const findings = [
      { kind: 'retry_advice' as const, messageId: 'm', subjectId: 's' },
      { kind: 'false_status_claim' as const, claimId: 'c' },
      { kind: 'missing_agent_activity' as const },
    ];
    // Act
    const procedures = selectProcedures(findings, catalog, '2026-09-23');
    // Assert
    assert.deepEqual(
      procedures.map((p) => p.citation),
      ['[procedure-3 v2]', '[procedure-8 v2]', '[procedure-10 v2]'],
    );
  });

  it('should fall back to the default procedure when nothing was found', () => {
    // Arrange
    const findings: never[] = [];
    // Act
    const procedures = selectProcedures(findings, catalog, '2026-09-23');
    // Assert
    assert.deepEqual(
      procedures.map((p) => [p.documentId, p.because]),
      [['procedure-4', 'default']],
    );
  });

  it('should say so when no version is in force on the case date', () => {
    // Arrange
    const findings = [{ kind: 'bank_unreachable' as const, cause: 'unreachable' as const }];
    // Act
    const procedures = selectProcedures(findings, catalog, '2026-08-15');
    // Assert
    assert.equal(procedures[0].citation, '[procedure-10 — no version in force]');
    assert.equal(procedures[0].version, null);
  });
});
