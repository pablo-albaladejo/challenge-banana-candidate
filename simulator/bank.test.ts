import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seedBank } from './seed';
import { bankDb } from './db';
import { listAccounts, operationByReference, setScenario, transfer } from './bank';
const input = {
  fromAccountId: 'acc-lucia',
  toAccountId: 'acc-bruno',
  amountCents: 1000,
  concept: 'Test',
};
function snapshot() {
  return {
    accounts: bankDb().prepare('SELECT * FROM accounts ORDER BY id').all(),
    movements: bankDb().prepare('SELECT * FROM movements ORDER BY id').all(),
    operations: bankDb().prepare('SELECT * FROM operations ORDER BY id').all(),
  };
}
const totalBalance = () =>
  (bankDb().prepare('SELECT SUM(balanceCents) AS total FROM accounts').get() as { total: number })
    .total;
describe('transfer', () => {
  beforeEach(() => {
    seedBank();
    setScenario('normal');
  });
  it('should debit the source and credit the destination without creating money', () => {
    // Arrange
    const total = totalBalance(),
      balance = listAccounts('lucia')[0].balanceCents;
    // Act
    const result = transfer('lucia', 'test-normal', input);
    // Assert
    assert.equal(result.operation.status, 'completed');
    assert.equal(totalBalance(), total);
    assert.equal(listAccounts('lucia')[0].balanceCents, balance - 1000);
  });
  it('should replay the original operation when the same actor reuses a reference', () => {
    // Arrange
    const first = transfer('lucia', 'stable', input),
      before = snapshot();
    // Act
    const second = transfer('lucia', 'stable', input);
    // Assert
    assert.equal(second.operation.id, first.operation.id);
    assert.equal(second.replay, true);
    assert.deepEqual(snapshot(), before);
  });
  it('should reject a reused reference with a different payload', () => {
    // Arrange
    transfer('lucia', 'stable', input);
    // Act & Assert
    assert.throws(
      () => transfer('lucia', 'stable', { ...input, amountCents: 1200 }),
      /different operation/,
    );
  });
  it('should keep different references with the same payload as separate transfers', () => {
    // Arrange
    const a = transfer('lucia', 'one', input);
    // Act
    const b = transfer('lucia', 'two', input);
    // Assert
    assert.notEqual(a.operation.id, b.operation.id);
  });
  it("should reject transfers from another holder's account without changing the ledger", () => {
    // Arrange
    const before = snapshot();
    // Act & Assert
    assert.throws(() => transfer('bruno', 'foreign', input), /not authorized/);
    assert.deepEqual(snapshot(), before);
  });
  it('should reject transfers with insufficient funds without changing the ledger', () => {
    // Arrange
    const before = snapshot();
    // Act & Assert
    assert.throws(
      () => transfer('diego', 'low', { ...input, fromAccountId: 'acc-diego', amountCents: 10000 }),
      /Insufficient/,
    );
    assert.deepEqual(snapshot(), before);
  });
  it('should reject transfers initiated by an operator without changing the ledger', () => {
    // Arrange
    const before = snapshot();
    // Act & Assert
    assert.throws(() => transfer('marta', 'operator', input), /account holder/);
    assert.deepEqual(snapshot(), before);
  });
  it('should reject non-positive, non-integer and over-limit amounts without changing the ledger', () => {
    // Arrange
    const before = snapshot();
    // Act & Assert
    for (const amountCents of [-1, 0, 0.5, Infinity, 10000001])
      assert.throws(() => transfer('lucia', 'invalid', { ...input, amountCents }));
    assert.deepEqual(snapshot(), before);
  });
  it('should reject a destination equal to the source without changing the ledger', () => {
    // Arrange
    const before = snapshot();
    // Act & Assert
    assert.throws(() => transfer('lucia', 'same', { ...input, toAccountId: 'acc-lucia' }));
    assert.deepEqual(snapshot(), before);
  });
  it('should keep the ledger unchanged when the failure happens before commit', () => {
    // Arrange
    setScenario('reject-before');
    const before = snapshot();
    // Act
    const result = transfer('lucia', 'reject', input);
    // Assert
    assert.equal(result.fault, 'reject-before');
    assert.deepEqual(snapshot(), before);
  });
  it('should keep a single queryable effect when the response is lost', () => {
    // Arrange
    setScenario('lost-response');
    // Act
    const first = transfer('lucia', 'lost', input);
    // Assert
    assert.equal(first.fault, 'lost-response');
    assert.equal(operationByReference('lucia', 'lost')?.id, first.operation.id);
    assert.equal(operationByReference('bruno', 'lost'), undefined);
    assert.equal(transfer('lucia', 'lost', input).replay, true);
  });
});
describe('setScenario', () => {
  it('should repeat the same intermittent faults for the same seed', () => {
    // Arrange
    const run = () => {
      seedBank();
      setScenario('intermittent', 17);
      return Array.from({ length: 8 }, (_, i) => transfer('lucia', `sequence-${i}`, input).fault);
    };
    // Act
    const first = run(),
      second = run();
    // Assert
    assert.deepEqual(first, second);
    assert.ok(first.includes('lost-response'));
  });
});
