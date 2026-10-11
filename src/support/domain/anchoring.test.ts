import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anchor, missedByModel } from './anchoring';
import {
  evidenceMessageFactory,
  extractedClaimRowFactory,
} from '../../../tests/fixtures/factories';

const lucia = () =>
  evidenceMessageFactory.build({
    id: 'message-lucia-2',
    content: 'I could not complete the transfer. You can try again.',
  });

describe('anchor', () => {
  it('should keep a claim whose quote is copied from the assistant message', () => {
    // Arrange
    const message = lucia();
    const row = extractedClaimRowFactory.build({ messageId: message.id });
    // Act
    const { claims, dropped } = anchor([row], [message]);
    // Assert
    assert.deepEqual(claims, [
      {
        id: `${message.id}#0`,
        messageId: message.id,
        quote: row.quote,
        extractedBy: 'model',
        kind: 'operation_status',
        status: 'not_completed',
        amountCents: null,
        reference: null,
      },
    ]);
    assert.equal(dropped, 0);
  });

  it('should drop a claim whose quote is not in the message it names', () => {
    // Arrange
    const message = lucia();
    const row = extractedClaimRowFactory.build({
      messageId: message.id,
      quote: 'The transfer was completed.',
      status: 'completed',
    });
    // Act
    const { claims, dropped } = anchor([row], [message]);
    // Assert
    assert.deepEqual(claims, []);
    assert.equal(dropped, 1);
  });

  it('should drop a claim taken from a customer message', () => {
    // Arrange
    const message = evidenceMessageFactory.build({
      role: 'user',
      content: 'Transfer EUR 85 to Bruno for the team dinner.',
    });
    const row = extractedClaimRowFactory.build({
      messageId: message.id,
      quote: 'Transfer EUR 85 to Bruno',
      kind: 'amount',
      amountCents: 8500,
      status: null,
    });
    // Act
    const { dropped } = anchor([row], [message]);
    // Assert
    assert.equal(dropped, 1);
  });

  it('should drop a claim naming a message of another conversation', () => {
    // Arrange
    const row = extractedClaimRowFactory.build({ messageId: 'message-elsewhere' });
    // Act
    const { dropped } = anchor([row], [lucia()]);
    // Assert
    assert.equal(dropped, 1);
  });

  it('should drop an amount claim whose amount the quote does not state', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: 'I sent EUR 85 to Bruno.' });
    const row = extractedClaimRowFactory.build({
      messageId: message.id,
      quote: 'I sent EUR 85 to Bruno.',
      kind: 'amount',
      amountCents: 85000,
      status: null,
    });
    // Act
    const { claims, dropped } = anchor([row], [message]);
    // Assert
    assert.deepEqual(claims, []);
    assert.equal(dropped, 1);
  });

  it('should null an amount the quote does not state and keep the status claim', () => {
    // Arrange
    const message = lucia();
    const row = extractedClaimRowFactory.build({ messageId: message.id, amountCents: 8500 });
    // Act
    const { claims } = anchor([row], [message]);
    // Assert
    assert.equal(claims.length, 1);
    assert.equal('amountCents' in claims[0] && claims[0].amountCents, null);
  });

  it('should drop a reference claim whose reference the quote does not state', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: 'Your reference is ref-abc-1.' });
    const row = extractedClaimRowFactory.build({
      messageId: message.id,
      quote: 'Your reference is ref-abc-1.',
      kind: 'reference',
      reference: 'ref-made-up',
      status: null,
    });
    // Act
    const { dropped } = anchor([row], [message]);
    // Assert
    assert.equal(dropped, 1);
  });

  it('should keep a reference the quote states, lower-cased as the scanner reads it', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: 'Your reference is REF-ABC-1.' });
    const row = extractedClaimRowFactory.build({
      messageId: message.id,
      quote: 'Your reference is REF-ABC-1.',
      kind: 'reference',
      reference: 'REF-ABC-1',
      status: null,
    });
    // Act
    const { claims } = anchor([row], [message]);
    // Assert
    assert.equal(claims[0].kind === 'reference' && claims[0].reference, 'ref-abc-1');
  });

  it('should drop a status claim that its own quote words as another status', () => {
    // Arrange
    const message = lucia();
    const row = extractedClaimRowFactory.build({ messageId: message.id, status: 'completed' });
    // Act
    const { claims, dropped } = anchor([row], [message]);
    // Assert
    assert.deepEqual(claims, []);
    assert.equal(dropped, 1);
  });

  it('should keep a status the model read from a paraphrase the scanners do not know', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: 'Your money is on its way to Bruno.' });
    const row = extractedClaimRowFactory.build({
      messageId: message.id,
      quote: 'Your money is on its way to Bruno.',
      status: 'pending',
    });
    // Act
    const { claims } = anchor([row], [message]);
    // Assert
    assert.equal(claims[0].kind === 'operation_status' && claims[0].status, 'pending');
  });

  it('should keep a policy amount the quote states', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: 'The Aurora monthly fee is EUR 6.' });
    const row = extractedClaimRowFactory.build({
      messageId: message.id,
      quote: 'The Aurora monthly fee is EUR 6.',
      kind: 'policy_amount',
      amountCents: 600,
      status: null,
      policy: 'monthly_fee',
      product: 'aurora',
    });
    // Act
    const { claims } = anchor([row], [message]);
    // Assert
    assert.deepEqual(claims, [
      {
        id: `${message.id}#0`,
        messageId: message.id,
        quote: row.quote,
        extractedBy: 'model',
        kind: 'policy_amount',
        policy: 'monthly_fee',
        product: 'aurora',
        amountCents: 600,
      },
    ]);
  });

  it('should drop a policy claim with no policy kind', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: 'The Aurora monthly fee is EUR 6.' });
    const row = extractedClaimRowFactory.build({
      messageId: message.id,
      quote: 'The Aurora monthly fee is EUR 6.',
      kind: 'policy_amount',
      amountCents: 600,
      status: null,
      policy: null,
    });
    // Act
    const { dropped } = anchor([row], [message]);
    // Assert
    assert.equal(dropped, 1);
  });

  it('should number the kept claims of each message in order', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: 'I sent EUR 85. It was completed.' });
    const rows = [
      extractedClaimRowFactory.build({
        messageId: message.id,
        quote: 'I sent EUR 85.',
        kind: 'amount',
        amountCents: 8500,
        status: null,
      }),
      extractedClaimRowFactory.build({
        messageId: message.id,
        quote: 'It was completed.',
        status: 'completed',
      }),
    ];
    // Act
    const { claims } = anchor(rows, [message]);
    // Assert
    assert.deepEqual(
      claims.map((c) => c.id),
      [`${message.id}#0`, `${message.id}#1`],
    );
  });
});

describe('missedByModel', () => {
  it('should return the status phrase the model left out as a pattern-matched claim', () => {
    // Arrange
    const message = lucia();
    // Act
    const net = missedByModel([message], []);
    // Assert
    assert.deepEqual(
      net.map((c) => [c.kind, c.extractedBy]),
      [['operation_status', 'regex']],
    );
  });

  it('should count a policy amount the model extracted as covering that amount', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: 'The Aurora monthly fee is EUR 6.' });
    const row = extractedClaimRowFactory.build({
      messageId: message.id,
      quote: 'The Aurora monthly fee is EUR 6.',
      kind: 'policy_amount',
      amountCents: 600,
      status: null,
      policy: 'monthly_fee',
      product: 'aurora',
    });
    const { claims } = anchor([row], [message]);
    // Act
    const net = missedByModel([message], claims);
    // Assert
    assert.deepEqual(net, []);
  });
});
