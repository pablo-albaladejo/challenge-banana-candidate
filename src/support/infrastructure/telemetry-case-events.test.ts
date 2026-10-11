import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceHash } from './telemetry-case-events';
import {
  caseEvidenceFactory,
  evidenceIntentFactory,
  evidenceMessageFactory,
} from '../../../tests/fixtures/factories';

describe('evidenceHash', () => {
  it('should hash the same evidence ids to the same value whatever the message text', () => {
    // Arrange
    const message = evidenceMessageFactory.build();
    const one = caseEvidenceFactory.build({ messages: [message] });
    const other = caseEvidenceFactory.build({
      messages: [{ ...message, content: `${message.content} edited` }],
    });
    // Act
    const hashes = [evidenceHash(one), evidenceHash(other)];
    // Assert
    assert.equal(hashes[0], hashes[1]);
    assert.match(hashes[0], /^[0-9a-f]{64}$/);
  });

  it('should change when an intent status changes', () => {
    // Arrange
    const failed = caseEvidenceFactory.build({ intents: [evidenceIntentFactory.build()] });
    const completed = caseEvidenceFactory.build({
      intents: [evidenceIntentFactory.build({ status: 'completed' })],
    });
    // Act
    const hashes = [evidenceHash(failed), evidenceHash(completed)];
    // Assert
    assert.notEqual(hashes[0], hashes[1]);
  });
});
