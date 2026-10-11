import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BankFailure } from '../../shared/domain/bank-failure';
import {
  isStale,
  isUnverified,
  reconcileDecision,
  shouldReconcile,
  staleProcessingMs,
} from './reconciliation';
import { intentFactory, intentRowOf } from '../../../tests/fixtures/factories';
import type { Intent } from '../../../tests/fixtures/factories';

const staleMs = 1000;
const nowMs = Date.parse('2026-09-24T09:00:00.000Z');
const at = (msAgo: number) => new Date(nowMs - msAgo).toISOString();
const row = (attributes: Partial<Intent>) => intentRowOf(intentFactory.build(attributes));
const notFound = new BankFailure('notFound', 404, 'Operation not found.');

describe('staleProcessingMs', () => {
  it('should allow twice the longest dispatch before a processing intent is stale', () => {
    // Arrange
    const bankTimeoutMs = 1400;
    // Act
    const ms = staleProcessingMs(bankTimeoutMs);
    // Assert
    assert.equal(ms, 2 * 2 * 1400);
  });
});

describe('isStale', () => {
  it('should measure staleness from dispatched_at', () => {
    // Arrange
    const intent = row({ createdAt: at(10 * staleMs), dispatchedAt: at(staleMs / 2) });
    // Act
    const stale = isStale(intent, nowMs, staleMs);
    // Assert
    assert.equal(stale, false);
  });

  it('should fall back to created_at on older rows', () => {
    // Arrange
    const intent = row({ createdAt: at(2 * staleMs), dispatchedAt: null });
    // Act
    const stale = isStale(intent, nowMs, staleMs);
    // Assert
    assert.equal(stale, true);
  });
});

describe('isUnverified', () => {
  it('should consider unknown and failed unverified at any age', () => {
    // Arrange
    const intents = [row({ status: 'unknown', createdAt: at(0) }), row({ status: 'failed' })];
    // Act
    const unverified = intents.map((intent) => isUnverified(intent, nowMs, staleMs));
    // Assert
    assert.deepEqual(unverified, [true, true]);
  });

  it('should consider a fresh processing intent still owned by its dispatch', () => {
    // Arrange
    const intent = row({ status: 'processing', createdAt: at(0) });
    // Act
    const unverified = isUnverified(intent, nowMs, staleMs);
    // Assert
    assert.equal(unverified, false);
  });
});

describe('shouldReconcile', () => {
  it('should skip an intent without a bank reference', () => {
    // Arrange
    const intent = row({ status: 'unknown', bankReference: null });
    // Act
    const reconcile = shouldReconcile(intent, false, nowMs, staleMs);
    // Assert
    assert.equal(reconcile, false);
  });

  it('should skip an intent whose dispatch is in flight', () => {
    // Arrange
    const intent = row({ status: 'unknown', bankReference: 'ref-1' });
    // Act
    const reconcile = shouldReconcile(intent, true, nowMs, staleMs);
    // Assert
    assert.equal(reconcile, false);
  });
});

describe('reconcileDecision', () => {
  it('should complete an intent the bank found', () => {
    // Arrange
    const intent = row({ status: 'unknown', bankReference: 'ref-1' });
    // Act
    const decision = reconcileDecision(intent, { operation: { id: 'op-1' } }, nowMs, staleMs);
    // Assert
    assert.deepEqual(decision, {
      to: 'completed',
      fields: { operation_id: 'op-1', error: null },
    });
  });

  it('should fail a stale unknown intent the bank has no operation for', () => {
    // Arrange
    const intent = row({ status: 'unknown', bankReference: 'ref-1', createdAt: at(2 * staleMs) });
    // Act
    const decision = reconcileDecision(intent, { error: notFound }, nowMs, staleMs);
    // Assert
    assert.deepEqual(decision, {
      to: 'failed',
      fields: { error: 'The bank has no operation for this reference.' },
    });
  });

  it('should leave a fresh intent the bank has no operation for', () => {
    // Arrange
    const intent = row({ status: 'unknown', bankReference: 'ref-1', createdAt: at(0) });
    // Act
    const decision = reconcileDecision(intent, { error: notFound }, nowMs, staleMs);
    // Assert
    assert.equal(decision, null);
  });

  it('should leave a failed intent the bank has no operation for', () => {
    // Arrange
    const intent = row({ status: 'failed', bankReference: 'ref-1', createdAt: at(2 * staleMs) });
    // Act
    const decision = reconcileDecision(intent, { error: notFound }, nowMs, staleMs);
    // Assert
    assert.equal(decision, null);
  });

  it('should leave the intent when the bank is unreachable', () => {
    // Arrange
    const intent = row({ status: 'unknown', bankReference: 'ref-1', createdAt: at(2 * staleMs) });
    const unreachable = new BankFailure('unreachable', 504, 'No response received from the bank.');
    // Act
    const decision = reconcileDecision(intent, { error: unreachable }, nowMs, staleMs);
    // Assert
    assert.equal(decision, null);
  });
});
