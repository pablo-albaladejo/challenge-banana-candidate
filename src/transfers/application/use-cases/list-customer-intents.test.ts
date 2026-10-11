import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { transfers } from '../../entry-points/dependencies';
import { persistIntent } from '../../../../tests/fixtures/factories';

describe('listCustomerIntents', () => {
  it('should list the reference of every intent of the customer and of no one else', () => {
    // Arrange
    const userId = `customer-${faker.string.uuid()}`;
    const sent = persistIntent({ userId, bankReference: `ref-${faker.string.uuid()}` });
    const prepared = persistIntent({ userId, bankReference: null });
    persistIntent();
    // Act
    const intents = transfers().listCustomerIntents({ userId });
    // Assert
    assert.deepEqual(
      intents.sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: sent.id, bank_reference: sent.bankReference },
        { id: prepared.id, bank_reference: null },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
});
