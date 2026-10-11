import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { httpTransfersBank } from './http-transfers-bank.adapter';
import { BankFailure } from '../../shared/domain/bank-failure';
import { resetBank, startBank, stopBank } from '../../../tests/support/bank';
import { customers, historicTransfer, unknown } from '../../../tests/fixtures/world';

describe('httpTransfersBank', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());

  it("should translate a 404 into a not-found BankFailure with the bank's message", async () => {
    // Arrange
    const reference = unknown.reference;
    // Act & Assert
    await assert.rejects(httpTransfersBank.operation(customers.lucia, reference), (e) => {
      assert.ok(e instanceof BankFailure);
      assert.deepEqual([e.reason, e.status, e.message], ['notFound', 404, 'Operation not found.']);
      return true;
    });
  });

  it("should return the bank's operation for a known reference", async () => {
    // Arrange
    const reference = historicTransfer.reference;
    // Act
    const operation = await httpTransfersBank.operation(customers.lucia, reference);
    // Assert
    assert.equal(operation.id, historicTransfer.operationId);
  });
});
