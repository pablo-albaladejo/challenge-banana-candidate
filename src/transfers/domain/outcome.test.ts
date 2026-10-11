import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BankFailure } from '../../shared/domain/bank-failure';
import { DISPATCH_ATTEMPTS, dispatchOutcome, shouldRetryDispatch, storedOutcome } from './outcome';
import {
  intentFactory,
  intentRowOf,
  transferInputFactory,
} from '../../../tests/fixtures/factories';

describe('dispatchOutcome', () => {
  it('should treat an unreachable bank as an unknown outcome with the unconfirmed message', () => {
    // Arrange
    const error = new BankFailure('unreachable', 504, 'No response received from the bank.');
    // Act
    const outcome = dispatchOutcome(error);
    // Assert
    assert.deepEqual(outcome, {
      status: 'unknown',
      error:
        'The bank did not confirm this transfer. It will be checked with the bank before any retry.',
    });
  });

  it("should treat a bank rejection as failed with the bank's message", () => {
    // Arrange
    const error = new BankFailure('rejected', 422, 'Insufficient funds.');
    // Act
    const outcome = dispatchOutcome(error);
    // Assert
    assert.deepEqual(outcome, { status: 'failed', error: 'Insufficient funds.' });
  });

  it('should treat a bank not-found as failed', () => {
    // Arrange
    const error = new BankFailure('notFound', 404, 'Account not found.');
    // Act
    const outcome = dispatchOutcome(error);
    // Assert
    assert.deepEqual(outcome, { status: 'failed', error: 'Account not found.' });
  });

  it('should treat any other error as failed with its message', () => {
    // Arrange
    const error = new TypeError('fetch failed');
    // Act
    const outcome = dispatchOutcome(error);
    // Assert
    assert.deepEqual(outcome, { status: 'failed', error: 'fetch failed' });
  });

  it('should fall back to "Transfer error" for a non-Error throw', () => {
    // Arrange
    const thrown = 'boom';
    // Act
    const outcome = dispatchOutcome(thrown);
    // Assert
    assert.deepEqual(outcome, { status: 'failed', error: 'Transfer error' });
  });
});

describe('shouldRetryDispatch', () => {
  it('should retry only an unreachable failure before the last attempt', () => {
    // Arrange
    const unreachable = new BankFailure('unreachable', 503, 'Service unavailable.');
    const rejected = new BankFailure('rejected', 422, 'Insufficient funds.');
    const last = DISPATCH_ATTEMPTS - 1;
    // Act
    const decisions = [
      shouldRetryDispatch(unreachable, 0),
      shouldRetryDispatch(unreachable, last),
      shouldRetryDispatch(rejected, 0),
      shouldRetryDispatch(new Error('x'), 0),
    ];
    // Assert
    assert.deepEqual(decisions, [true, false, false, false]);
  });
});

describe('storedOutcome', () => {
  it('should answer a completed row as a replayed completed operation', () => {
    // Arrange
    const input = transferInputFactory.build();
    const row = intentRowOf(
      intentFactory.build({
        payload: input,
        status: 'completed',
        operationId: 'op-1',
        bankReference: 'ref-1',
      }),
    );
    // Act
    const outcome = storedOutcome(row, input);
    // Assert
    assert.deepEqual(outcome, {
      status: 'completed',
      operation: {
        ...input,
        id: 'op-1',
        userId: row.user_id,
        reference: 'ref-1',
        status: 'completed',
      },
      intentId: row.id,
      replay: true,
    });
  });

  it('should answer any other stored status with the changed-state message', () => {
    // Arrange
    const input = transferInputFactory.build();
    const row = intentRowOf(intentFactory.build({ payload: input, status: 'failed' }));
    // Act
    const outcome = storedOutcome(row, input);
    // Assert
    assert.deepEqual(outcome, {
      status: 'failed',
      error:
        'This transfer changed state while it was being sent. Check its status before retrying.',
      intentId: row.id,
    });
  });
});
