import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { wireTransfers } from '../../entry-points/dependencies';
import { insertApproval } from '../../infrastructure/sqlite-approvals.repo';
import { fixedClock } from '../../../../tests/support/clock';
import { approvalFactory } from '../../../../tests/fixtures/factories';

describe('listLiveProposals with a fixed clock', () => {
  it('should report the live proposals that are still valid at the clock time', () => {
    // Arrange
    const clock = fixedClock();
    const userId = `customer-${faker.string.uuid()}`;
    const live = approvalFactory.build({ userId, expiresAt: '2026-09-24T09:05:00.000Z' });
    const expired = approvalFactory.build({ userId, expiresAt: '2026-09-24T08:55:00.000Z' });
    insertApproval(live);
    insertApproval(expired);
    const { listLiveProposals } = wireTransfers({ clock });
    // Act
    const proposals = listLiveProposals({ userId });
    // Assert
    assert.deepEqual(
      proposals.map((p) => [p.id, p.payload]),
      [[live.id, JSON.parse(live.payload)]],
    );
  });
});
