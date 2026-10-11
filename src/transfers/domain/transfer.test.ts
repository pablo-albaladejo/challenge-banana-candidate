import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'zod';
import { BadRequestError, ConflictError, ForbiddenError } from '../../shared/domain/errors';
import {
  assertKnownDestination,
  assertOwnsSource,
  assertSameIntent,
  parseTransfer,
  payloadOf,
} from './transfer';
import {
  intentFactory,
  intentRowOf,
  transferInputFactory,
} from '../../../tests/fixtures/factories';
import { accounts, customers, unknown } from '../../../tests/fixtures/world';

const luciaAccounts = [{ id: accounts.lucia }, { id: accounts.luciaSavings }];
const luciaContacts = [{ id: accounts.bruno }];

describe('parseTransfer', () => {
  it('should reject a transfer to the same account', () => {
    // Arrange
    const input = transferInputFactory.build();
    // Act & Assert
    assert.throws(
      () => parseTransfer({ ...input, toAccountId: input.fromAccountId }),
      (e) => {
        assert.ok(e instanceof ZodError);
        assert.equal(e.issues[0].message, 'Source and destination accounts must differ.');
        return true;
      },
    );
  });
});

describe('payloadOf', () => {
  it('should serialise the payload in schema key order whatever the argument order', () => {
    // Arrange
    const input = transferInputFactory.build();
    const reordered = {
      concept: input.concept,
      amountCents: input.amountCents,
      toAccountId: input.toAccountId,
      fromAccountId: input.fromAccountId,
    };
    // Act
    const payload = payloadOf(reordered);
    // Assert
    assert.equal(
      payload,
      JSON.stringify({
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amountCents: input.amountCents,
        concept: input.concept,
      }),
    );
  });
});

describe('assertSameIntent', () => {
  it('should reject an intent id reused by another customer as a conflict', () => {
    // Arrange
    const intent = intentFactory.build();
    const previous = intentRowOf(intent);
    // Act & Assert
    assert.throws(
      () => assertSameIntent(previous, customers.bruno, previous.payload),
      (e) => {
        assert.ok(e instanceof ConflictError);
        assert.equal(e.message, 'This intent belongs to a different payload.');
        return true;
      },
    );
  });

  it('should reject an intent id reused with another payload as a conflict', () => {
    // Arrange
    const intent = intentFactory.build();
    const previous = intentRowOf(intent);
    const other = payloadOf({ ...intent.payload, amountCents: intent.payload.amountCents + 1 });
    // Act & Assert
    assert.throws(
      () => assertSameIntent(previous, intent.userId, other),
      (e) => {
        assert.ok(e instanceof ConflictError);
        assert.equal(e.message, 'This intent belongs to a different payload.');
        return true;
      },
    );
  });

  it('should accept the same customer and payload', () => {
    // Arrange
    const intent = intentFactory.build();
    const previous = intentRowOf(intent);
    // Act & Assert
    assert.doesNotThrow(() => assertSameIntent(previous, intent.userId, previous.payload));
  });
});

describe('assertOwnsSource', () => {
  it('should reject a source account the customer does not own as forbidden', () => {
    // Arrange
    const input = transferInputFactory.build({ fromAccountId: accounts.bruno });
    // Act & Assert
    assert.throws(
      () => assertOwnsSource(luciaAccounts, input),
      (e) => {
        assert.ok(e instanceof ForbiddenError);
        assert.equal(e.message, 'This account does not belong to this person.');
        return true;
      },
    );
  });
});

describe('assertKnownDestination', () => {
  it('should accept a contact as destination', () => {
    // Arrange
    const input = transferInputFactory.build({ toAccountId: accounts.bruno });
    // Act & Assert
    assert.doesNotThrow(() => assertKnownDestination(luciaAccounts, luciaContacts, input));
  });

  it('should reject an unknown destination as a bad request', () => {
    // Arrange
    const input = transferInputFactory.build({ toAccountId: unknown.account });
    // Act & Assert
    assert.throws(
      () => assertKnownDestination(luciaAccounts, luciaContacts, input),
      (e) => {
        assert.ok(e instanceof BadRequestError);
        assert.equal(e.message, 'The destination account does not exist.');
        return true;
      },
    );
  });
});
