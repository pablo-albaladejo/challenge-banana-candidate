import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { accounts, contacts, movements, operation, operatorCustomer, transfer } from './bank';
import { BankError } from './client';
import {
  balanceOf,
  bankSnapshot,
  resetBank,
  startBank,
  stopBank,
} from '../../../tests/support/bank';
import { transferInputFactory } from '../../../tests/fixtures/factories';
import {
  accounts as world,
  customers,
  historicTransfer,
  operators,
  unknown,
} from '../../../tests/fixtures/world';

describe('bank port', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());

  describe('accounts', () => {
    it('should return the accounts the actor holds', async () => {
      // Arrange
      const actor = customers.lucia;
      // Act
      const held = await accounts(actor);
      // Assert
      assert.deepEqual(
        held.map((a) => a.id),
        [world.lucia, world.luciaSavings],
      );
      assert.ok(held.every((a) => a.userId === actor));
    });
  });

  describe('contacts', () => {
    it('should list the accounts of other customers as destinations', async () => {
      // Arrange
      const actor = customers.lucia;
      // Act
      const destinations = await contacts(actor);
      // Assert
      const ids = destinations.map((c) => c.id);
      assert.ok(ids.includes(world.bruno));
      assert.ok(!ids.includes(world.lucia));
    });
  });

  describe('movements', () => {
    it('should return the movements of the actor accounts only', async () => {
      // Arrange
      const actor = customers.lucia;
      const held: string[] = [world.lucia, world.luciaSavings];
      // Act
      const recent = await movements(actor);
      // Assert
      assert.ok(recent.some((m) => m.operationId === historicTransfer.operationId));
      assert.ok(recent.every((m) => held.includes(m.accountId)));
    });
  });

  describe('transfer', () => {
    it('should book the transfer at the bank under the given reference', async () => {
      // Arrange
      const input = transferInputFactory.build();
      const reference = `ref-${faker.string.uuid()}`;
      const fromBefore = await balanceOf(input.fromAccountId);
      // Act
      const booked = await transfer(customers.lucia, input, reference);
      // Assert
      assert.equal(booked.reference, reference);
      assert.equal(booked.amountCents, input.amountCents);
      assert.equal(await balanceOf(input.fromAccountId), fromBefore - input.amountCents);
    });
    it('should replay the original operation when the reference is reused', async () => {
      // Arrange
      const input = transferInputFactory.build();
      const reference = `ref-${faker.string.uuid()}`;
      const first = await transfer(customers.lucia, input, reference);
      const before = await bankSnapshot();
      // Act
      const replay = await transfer(customers.lucia, input, reference);
      // Assert
      assert.equal(replay.id, first.id);
      assert.deepEqual(await bankSnapshot(), before);
    });
  });

  describe('operation', () => {
    it('should find the actor operation by its reference', async () => {
      // Arrange
      const reference = historicTransfer.reference;
      // Act
      const found = await operation(customers.lucia, reference);
      // Assert
      assert.equal(found.id, historicTransfer.operationId);
    });
    it('should find an operation whose reference needs URL encoding', async () => {
      // Arrange
      const reference = `ref/${faker.string.uuid()}?x=1 #`;
      const booked = await transfer(customers.lucia, transferInputFactory.build(), reference);
      // Act
      const found = await operation(customers.lucia, reference);
      // Assert
      assert.equal(found.id, booked.id);
    });
    it('should reject an unknown reference with a 404 BankError', async () => {
      // Arrange
      const reference = unknown.reference;
      // Act & Assert
      await assert.rejects(operation(customers.lucia, reference), (e) => {
        assert.ok(e instanceof BankError);
        assert.equal(e.status, 404);
        return true;
      });
    });
  });

  describe('operatorCustomer', () => {
    it('should return the customer operations to an operator', async () => {
      // Arrange
      const customer = customers.lucia;
      // Act
      const record = await operatorCustomer(operators.marta, customer);
      // Assert
      assert.ok(record.operations.some((o) => o.reference === historicTransfer.reference));
      assert.ok(record.accounts.every((a) => a.userId === customer));
    });
    it('should reject a customer actor with a 403 BankError', async () => {
      // Arrange
      const actor = customers.bruno;
      // Act & Assert
      await assert.rejects(operatorCustomer(actor, customers.lucia), (e) => {
        assert.ok(e instanceof BankError);
        assert.equal(e.status, 403);
        return true;
      });
    });
  });
});
