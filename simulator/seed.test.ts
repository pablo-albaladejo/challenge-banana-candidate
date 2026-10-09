import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seedBank } from './seed';
import { bankDb } from './db';
import { setScenario, transfer } from './bank';
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
describe('seedBank', () => {
  it('should restore the same accounts and transactions after activity', () => {
    // Arrange
    seedBank();
    const before = snapshot();
    setScenario('normal');
    transfer('lucia', 'test-reset', input);
    // Act
    seedBank();
    // Assert
    assert.deepEqual(snapshot(), before);
  });
  it('should seed balances that match the sum of their movements', () => {
    // Arrange
    seedBank();
    // Act
    const accounts = snapshot().accounts as { id: string; balanceCents: number }[];
    // Assert
    for (const a of accounts) {
      const sum = (
        bankDb()
          .prepare('SELECT SUM(amountCents) AS total FROM movements WHERE accountId=?')
          .get(a.id) as { total: number }
      ).total;
      assert.equal(sum, a.balanceCents);
    }
  });
});
