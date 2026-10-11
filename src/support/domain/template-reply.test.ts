import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { templateReply } from './template-reply';
import { scanCommitments } from './scanners';
import { verifiedFactFactory } from '../../../tests/fixtures/factories';

describe('templateReply', () => {
  it('should correct a contradicted claim once, in the words of the fact that holds', () => {
    // Arrange
    const fact = verifiedFactFactory.build({ id: 'F2', kind: 'status', value: 'completed' });
    const verdict = {
      claimId: 'c',
      verdict: 'contradicted' as const,
      reason: 'contradicted_by_operation' as const,
      evidence: fact.evidence,
      correctFactId: 'F2',
    };
    // Act
    const reply = templateReply('Lucía', [fact], [verdict, { ...verdict, claimId: 'd' }], []);
    // Assert
    assert.deepEqual(reply.split('\n'), [
      'Hello Lucía, thank you for your patience. A member of our support team has reviewed your case.',
      `Correction: ${fact.statement}`,
      'Banana Bank support',
    ]);
  });

  it('should tell the customer not to pay twice after retry advice', () => {
    // Arrange
    const findings = [{ kind: 'retry_advice' as const, messageId: 'm', subjectId: 'op' }];
    // Act
    const reply = templateReply('Lucía', [], [], findings);
    // Assert
    assert.match(reply, /Please do not send this payment again: it has already been completed\./);
  });

  it('should promise only an update when a claim could not be verified', () => {
    // Arrange
    const verdict = {
      claimId: 'c',
      verdict: 'unverifiable' as const,
      reason: 'no_subject_found' as const,
      detail: '',
    };
    // Act
    const reply = templateReply('Diego', [], [verdict], []);
    // Assert
    assert.match(reply, /We are still confirming some details and will update you here\./);
  });

  it('should make no commitment the post-check would flag', () => {
    // Arrange
    const fact = verifiedFactFactory.build({ id: 'F1', kind: 'status', value: 'completed' });
    const contradicted = {
      claimId: 'c',
      verdict: 'contradicted' as const,
      reason: 'contradicted_by_operation' as const,
      evidence: fact.evidence,
      correctFactId: 'F1',
    };
    const open = {
      claimId: 'd',
      verdict: 'unverifiable' as const,
      reason: 'no_subject_found' as const,
      detail: '',
    };
    const findings = [{ kind: 'retry_advice' as const, messageId: 'm', subjectId: 'op' }];
    // Act
    const reply = templateReply('Lucía', [fact], [contradicted, open], findings);
    // Assert
    assert.deepEqual(scanCommitments(reply, [fact.statement]), []);
  });
});
