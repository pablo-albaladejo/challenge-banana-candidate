import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mappedStatus, resolveSubject } from './subject-resolution';
import {
  caseEvidenceFactory,
  evidenceIntentFactory,
  statusClaimFactory,
  windowOperationFactory,
} from '../../../tests/fixtures/factories';

describe('resolveSubject', () => {
  it('should tell two transfers apart by the amount the claim states', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [],
      allOperations: [
        windowOperationFactory.build({
          id: 'op-a',
          reference: 'ref-a',
          amountCents: 1000,
          linkedIntentId: null,
        }),
        windowOperationFactory.build({
          id: 'op-b',
          reference: 'ref-b',
          amountCents: 2000,
          linkedIntentId: null,
        }),
      ],
    });
    // Act
    const resolved = resolveSubject(
      statusClaimFactory.build({ status: 'completed', amountCents: 2000 }),
      evidence,
    );
    const ambiguous = resolveSubject(statusClaimFactory.build({ status: 'completed' }), evidence);
    // Assert
    assert.equal('subject' in resolved && resolved.subject.operation?.id, 'op-b');
    assert.deepEqual(ambiguous, { reason: 'ambiguous_subject' });
  });
});

describe('mappedStatus', () => {
  it('should map a processing intent with no operation to pending', () => {
    // Arrange
    const intent = evidenceIntentFactory.build({ status: 'processing' });
    // Act
    const mapped = mappedStatus({ kind: 'intent', intent, operation: null }, true);
    // Assert
    assert.deepEqual(mapped, { status: 'pending' });
  });

  it('should map any intent the bank booked to completed', () => {
    // Arrange
    const intent = evidenceIntentFactory.build({ status: 'unknown' });
    // Act
    const mapped = mappedStatus(
      { kind: 'intent', intent, operation: windowOperationFactory.build() },
      true,
    );
    // Assert
    assert.deepEqual(mapped, { status: 'completed' });
  });
});

describe('mappedStatus with the bank unreachable', () => {
  for (const status of ['processing', 'unknown', 'failed']) {
    it(`should settle nothing from a stored ${status} intent while the bank cannot be asked`, () => {
      // Arrange
      const intent = evidenceIntentFactory.build({ status });
      // Act
      const mapped = mappedStatus({ kind: 'intent', intent, operation: null }, false);
      // Assert
      assert.deepEqual(mapped, { reason: 'bank_unreachable' });
    });
  }
});
