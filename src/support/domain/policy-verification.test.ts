import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { policyEntryFor, salaryIn } from './policy-verification';
import {
  caseEvidenceFactory,
  evidenceMessageFactory,
  policyClaimFactory,
} from '../../../tests/fixtures/factories';
import { accounts } from '../../../tests/fixtures/world';
import { referenceDate } from '../../shared/domain/reference-date';

describe('salaryIn', () => {
  it('should pick the salary of the case month', () => {
    // Arrange
    const movements = [
      {
        id: 'm-aug',
        accountId: accounts.carla,
        amountCents: 175000,
        description: 'August salary',
        createdAt: '2026-08-02T10:00:00.000Z',
      },
      {
        id: 'm-sep',
        accountId: accounts.carla,
        amountCents: 175000,
        description: 'September salary',
        createdAt: '2026-09-02T10:00:00.000Z',
      },
    ];
    // Act
    const salary = salaryIn(movements, '2026-09-23');
    // Assert
    assert.equal(salary?.id, 'm-sep');
  });
});

describe('policyEntryFor', () => {
  /** Lucía's evidence with the assistant message the claim quotes sent at `at`. */
  const saidAt = (at: string) =>
    caseEvidenceFactory.build({
      messages: [evidenceMessageFactory.build({ id: 'message-lucia-2', created_at: at })],
    });

  it('should judge a claim made after the reference date on the reference date', () => {
    // Arrange
    const evidence = saidAt('2026-10-05T09:00:00.000Z');
    // Act
    const lookup = policyEntryFor(policyClaimFactory.build(), evidence);
    // Assert
    assert.equal('onDate' in lookup && lookup.onDate, referenceDate);
  });

  it('should judge a claim on the date it was made, before any fee was in force', () => {
    // Arrange
    const evidence = saidAt('2026-08-20T09:00:00.000Z');
    // Act
    const lookup = policyEntryFor(policyClaimFactory.build(), evidence);
    // Assert
    assert.deepEqual(lookup, { reason: 'no_policy_entry' });
  });

  it('should read the date of a claim in Europe/Madrid', () => {
    // Arrange
    const evidence = saidAt('2026-08-31T22:30:00.000Z');
    // Act
    const lookup = policyEntryFor(policyClaimFactory.build(), evidence);
    // Assert
    assert.equal('onDate' in lookup && lookup.onDate, '2026-09-01');
  });
});
