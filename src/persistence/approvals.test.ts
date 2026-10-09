import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalOf,
  consumeApproval,
  insertApproval,
  liveApprovalFor,
  liveApprovalsOf,
} from './approvals';
import { approvalFactory, transferInputFactory } from '../../tests/fixtures/factories';

describe('approvals repository', () => {
  it('should read back a stored approval as not consumed', () => {
    // Arrange
    const approval = approvalFactory.build();
    // Act
    insertApproval(approval);
    // Assert
    assert.deepEqual(approvalOf(approval.id, approval.userId), {
      id: approval.id,
      user_id: approval.userId,
      intent_id: approval.intentId,
      payload: approval.payload,
      expires_at: approval.expiresAt,
      consumed_at: null,
    });
  });
  it('should consume a live approval exactly once', () => {
    // Arrange
    const approval = approvalFactory.build();
    insertApproval(approval);
    const now = new Date().toISOString();
    // Act
    const first = consumeApproval({ ...approval, now });
    const second = consumeApproval({ ...approval, now });
    // Assert
    assert.equal(first, 1);
    assert.equal(second, 0);
    assert.equal(approvalOf(approval.id, approval.userId)?.consumed_at, now);
  });
  it('should reject consuming an expired approval', () => {
    // Arrange
    const approval = approvalFactory.build({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    insertApproval(approval);
    // Act
    const changes = consumeApproval({ ...approval, now: new Date().toISOString() });
    // Assert
    assert.equal(changes, 0);
  });
  it('should reject consuming an approval for a different payload', () => {
    // Arrange
    const approval = approvalFactory.build();
    insertApproval(approval);
    const payload = JSON.stringify(transferInputFactory.build());
    // Act
    const changes = consumeApproval({ ...approval, payload, now: new Date().toISOString() });
    // Assert
    assert.equal(changes, 0);
  });
  it('should find the live approval of an intent and the live approvals of a customer', () => {
    // Arrange
    const approval = approvalFactory.build();
    insertApproval(approval);
    const now = new Date().toISOString();
    // Act
    const forIntent = liveApprovalFor(approval.intentId, approval.userId, now);
    const ofCustomer = liveApprovalsOf(approval.userId, now).map((a) => a.id);
    // Assert
    assert.deepEqual(forIntent, {
      id: approval.id,
      payload: approval.payload,
      expires_at: approval.expiresAt,
    });
    assert.ok(ofCustomer.includes(approval.id));
  });
});
