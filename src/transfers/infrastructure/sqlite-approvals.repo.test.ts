import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalOf,
  consumeApproval,
  insertApproval,
  liveApprovalFor,
  liveApprovalsOf,
} from './sqlite-approvals.repo';
import { faker } from '@faker-js/faker';
import { appDb } from '../../platform/db/db';
import { approvalFactory, transferInputFactory } from '../../../tests/fixtures/factories';

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
      checks: approval.checks,
    });
    assert.ok(ofCustomer.includes(approval.id));
  });
  it('should read back the stored pre-flight checks of a live approval', () => {
    // Arrange
    const approval = approvalFactory.build({
      checks: [
        {
          id: 'pending_twin',
          severity: 'warning',
          message: faker.lorem.sentence(),
          source: { kind: 'safeguard', id: 'P0-4' },
        },
      ],
    });
    insertApproval(approval);
    const now = new Date().toISOString();
    // Act
    const forIntent = liveApprovalFor(approval.intentId, approval.userId, now);
    const ofCustomer = liveApprovalsOf(approval.userId, now).find((a) => a.id === approval.id);
    // Assert
    assert.deepEqual(forIntent?.checks, approval.checks);
    assert.deepEqual(ofCustomer?.checks, approval.checks);
  });
  it('should read an approval stored before pre-flight checks existed as having none', () => {
    // Arrange: a row as migration 3 leaves it, with a NULL checks column.
    const approval = approvalFactory.build();
    appDb()
      .prepare(
        'INSERT INTO approvals(id,user_id,intent_id,payload,expires_at,consumed_at,checks) VALUES(?,?,?,?,?,NULL,NULL)',
      )
      .run(approval.id, approval.userId, approval.intentId, approval.payload, approval.expiresAt);
    const now = new Date().toISOString();
    // Act
    const forIntent = liveApprovalFor(approval.intentId, approval.userId, now);
    const ofCustomer = liveApprovalsOf(approval.userId, now).find((a) => a.id === approval.id);
    // Assert
    assert.deepEqual(forIntent?.checks, []);
    assert.deepEqual(ofCustomer?.checks, []);
  });
  it('should read stored checks that are not valid JSON as having none', () => {
    // Arrange
    const approval = approvalFactory.build();
    appDb()
      .prepare(
        'INSERT INTO approvals(id,user_id,intent_id,payload,expires_at,consumed_at,checks) VALUES(?,?,?,?,?,NULL,?)',
      )
      .run(
        approval.id,
        approval.userId,
        approval.intentId,
        approval.payload,
        approval.expiresAt,
        '[{not json',
      );
    const now = new Date().toISOString();
    // Act
    const forIntent = liveApprovalFor(approval.intentId, approval.userId, now);
    const ofCustomer = liveApprovalsOf(approval.userId, now).find((a) => a.id === approval.id);
    // Assert
    assert.deepEqual(forIntent?.checks, []);
    assert.deepEqual(ofCustomer?.checks, []);
  });
});
