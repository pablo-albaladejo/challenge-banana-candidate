import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findingsOf } from './case-findings';
import { verifyClaim } from './claim-verification';
import { regexClaims } from './regex-claims';
import {
  caseEvidenceFactory,
  evidenceIntentFactory,
  evidenceMessageFactory,
  windowOperationFactory,
} from '../../../tests/fixtures/factories';
import { historicTransfer } from '../../../tests/fixtures/world';

/** The findings of the evidence, with the claims pattern matching finds. */
const judge = (evidence: ReturnType<typeof caseEvidenceFactory.build>) => {
  const claims = regexClaims(evidence.messages);
  return findingsOf(
    evidence,
    claims,
    claims.map((c) => verifyClaim(c, evidence)),
  );
};

describe('findingsOf', () => {
  it('should flag the retry advice on a transfer the bank completed', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build();
    // Act
    const findings = judge(evidence);
    // Assert
    assert.deepEqual(
      findings.map((f) => f.kind),
      ['retry_advice', 'false_status_claim', 'missing_agent_activity'],
    );
    assert.deepEqual(findings[0], {
      kind: 'retry_advice',
      messageId: 'message-lucia-2',
      subjectId: historicTransfer.operationId,
    });
  });

  it('should name the completed transfer the retry advice is about', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [
        evidenceIntentFactory.build(),
        evidenceIntentFactory.build({
          id: 'intent-rent',
          status: 'completed',
          bank_reference: 'ref-rent',
          payload: { ...historicTransfer.payload, amountCents: 3000 },
        }),
      ],
      messages: [
        evidenceMessageFactory.build({
          id: 'message-rent',
          content: 'Your EUR 30 payment did not go through. Please try again.',
        }),
      ],
    });
    // Act
    const findings = judge(evidence);
    // Assert
    assert.deepEqual(
      findings.filter((f) => f.kind === 'retry_advice'),
      [{ kind: 'retry_advice', messageId: 'message-rent', subjectId: 'intent-rent' }],
    );
  });

  it('should leave retry advice alone when nothing was completed', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({ intents: [], allOperations: [] });
    // Act
    const findings = judge(evidence);
    // Assert
    assert.ok(!findings.some((f) => f.kind === 'retry_advice'));
  });

  it('should put an operation no intent holds first', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [],
      allOperations: [windowOperationFactory.build({ linkedIntentId: null })],
      messages: [evidenceMessageFactory.build({ content: 'Transfer completed.' })],
    });
    // Act
    const findings = judge(evidence);
    // Assert
    assert.deepEqual(findings[0], {
      kind: 'unlinked_operation',
      operationId: historicTransfer.operationId,
    });
  });

  it('should name unsettled intents and the twins sharing one payload', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [
        evidenceIntentFactory.build({ id: 'intent-a', status: 'unknown', bank_reference: 'ref-a' }),
        evidenceIntentFactory.build({
          id: 'intent-b',
          status: 'processing',
          bank_reference: 'ref-b',
        }),
      ],
      allOperations: [],
      messages: [],
    });
    // Act
    const findings = judge(evidence);
    // Assert
    assert.deepEqual(
      findings.filter((f) => f.kind !== 'missing_agent_activity'),
      [
        { kind: 'unsettled_intent', intentId: 'intent-a' },
        { kind: 'unsettled_intent', intentId: 'intent-b' },
        { kind: 'pending_twin', intentIds: ['intent-a', 'intent-b'] },
      ],
    );
  });

  it('should report the unreachable bank as a gap', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({ allOperations: null, accounts: null });
    // Act
    const findings = judge(evidence);
    // Assert
    assert.deepEqual(
      findings.map((f) => f.kind),
      ['bank_unreachable', 'missing_agent_activity'],
    );
  });

  it('should drop the missing-activity gap once agent events exist', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [],
      allOperations: [],
      messages: [],
      events: [
        { id: 'e', kind: 'tool.completed', created_at: '2026-09-23T16:41:00.000Z', data: {} },
      ],
    });
    // Act
    const findings = judge(evidence);
    // Assert
    assert.deepEqual(findings, []);
  });

  it('should judge retry advice on the conversation intents, not on an operation no intent holds', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [evidenceIntentFactory.build({ bank_reference: null })],
      allOperations: [windowOperationFactory.build({ linkedIntentId: null })],
    });
    // Act
    const findings = judge(evidence);
    // Assert
    assert.ok(!findings.some((f) => f.kind === 'retry_advice'));
  });

  it('should flag retry advice on an operation no intent holds when the conversation has no intent', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [],
      allOperations: [windowOperationFactory.build({ linkedIntentId: null })],
    });
    // Act
    const findings = judge(evidence);
    // Assert
    assert.deepEqual(
      findings.find((f) => f.kind === 'retry_advice'),
      {
        kind: 'retry_advice',
        messageId: 'message-lucia-2',
        subjectId: historicTransfer.operationId,
      },
    );
  });

  it('should flag retry advice even when the bank booked the transfer after the message', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      allOperations: [windowOperationFactory.build({ createdAt: '2026-09-23T18:00:00.000Z' })],
    });
    // Act
    const findings = judge(evidence);
    // Assert
    assert.equal(findings[0].kind, 'retry_advice');
  });

  it('should report a bank that refused the request apart from an unreachable one', () => {
    // Arrange
    const refused = caseEvidenceFactory.build({
      allOperations: null,
      accounts: null,
      bankFailure: 'refused',
    });
    const down = caseEvidenceFactory.build({
      allOperations: null,
      accounts: null,
      bankFailure: 'unreachable',
    });
    // Act
    const findings = [judge(refused), judge(down)].map((f) =>
      f.find((x) => x.kind === 'bank_unreachable'),
    );
    // Assert
    assert.deepEqual(findings, [
      { kind: 'bank_unreachable', cause: 'refused' },
      { kind: 'bank_unreachable', cause: 'unreachable' },
    ]);
  });
});
