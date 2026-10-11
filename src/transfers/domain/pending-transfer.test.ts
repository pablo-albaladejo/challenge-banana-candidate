import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { failedSince, toPendingTransfer } from './pending-transfer';
import { intentFactory, intentRowOf } from '../../../tests/fixtures/factories';

describe('failedSince', () => {
  it('should look back 24 hours for failed transfers', () => {
    // Arrange
    const now = new Date('2026-09-24T09:00:00.000Z');
    // Act
    const since = failedSince(now);
    // Assert
    assert.equal(since, '2026-09-23T09:00:00.000Z');
  });
});

describe('toPendingTransfer', () => {
  it('should show the operation id only when the bank booked one', () => {
    // Arrange
    const unbooked = intentFactory.build({ status: 'unknown' });
    const booked = intentFactory.build({ status: 'completed', operationId: 'op-1' });
    // Act
    const views = [unbooked, booked].map((intent) => toPendingTransfer(intentRowOf(intent)));
    // Assert
    assert.deepEqual(views, [
      {
        id: unbooked.id,
        status: 'unknown',
        payload: unbooked.payload,
        createdAt: unbooked.createdAt,
      },
      {
        id: booked.id,
        status: 'completed',
        payload: booked.payload,
        createdAt: booked.createdAt,
        operationId: 'op-1',
      },
    ]);
  });
});
