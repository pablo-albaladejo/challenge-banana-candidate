import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coverageNet, regexClaims, sentenceAround } from './regex-claims';
import { evidenceMessageFactory } from '../../../tests/fixtures/factories';

describe('sentenceAround', () => {
  it('should quote the whole sentence around a span', () => {
    // Arrange
    const text = 'Hello there. The fee is EUR 6. Bye.';
    // Act
    const quote = sentenceAround(text, 24, 29);
    // Assert
    assert.equal(quote, 'The fee is EUR 6.');
  });
});

describe('regexClaims', () => {
  it('should claim the status the assistant stated, with the single amount of its message', () => {
    // Arrange
    const message = evidenceMessageFactory.build({
      id: 'm1',
      content: 'Your transfer of EUR 85 was completed.',
    });
    // Act
    const claims = regexClaims([message]);
    // Assert
    assert.deepEqual(
      claims.map((c) => [c.id, c.kind, 'amountCents' in c ? c.amountCents : null]),
      [
        ['m1#0', 'amount', 8500],
        ['m1#1', 'operation_status', 8500],
      ],
    );
    assert.ok(claims.every((c) => c.extractedBy === 'regex' && c.quote === message.content));
  });

  it('should read only what the assistant said', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ role: 'user', content: 'Send EUR 85, ref-x.' });
    // Act
    const claims = regexClaims([message]);
    // Assert
    assert.deepEqual(claims, []);
  });

  it('should claim a reference and the ambiguous status beside it', () => {
    // Arrange
    const message = evidenceMessageFactory.build({
      id: 'm2',
      content: 'It is not yet completed, see ref-historic-lucia.',
    });
    // Act
    const claims = regexClaims([message]);
    // Assert
    assert.deepEqual(
      claims.map((c) => [c.kind, 'status' in c ? c.status : null]),
      [
        ['operation_status', 'ambiguous_status'],
        ['reference', null],
      ],
    );
  });

  for (const content of [
    'The transfer has not yet been completed.',
    'Your transfer has not failed.',
  ]) {
    it(`should claim ${JSON.stringify(content)} as an ambiguous status`, () => {
      // Arrange
      const message = evidenceMessageFactory.build({ content });
      // Act
      const claims = regexClaims([message]);
      // Assert
      assert.deepEqual(
        claims.map((c) => [c.kind, 'status' in c ? c.status : null]),
        [['operation_status', 'ambiguous_status']],
      );
    });
  }

  it('should claim a contracted failure as not completed', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: "Sorry, your transfer wasn't sent." });
    // Act
    const claims = regexClaims([message]);
    // Assert
    assert.deepEqual(
      claims.map((c) => [c.kind, 'status' in c ? c.status : null]),
      [['operation_status', 'not_completed']],
    );
  });
});

describe('regexClaims on the whitelisted shape', () => {
  /** Each claim as `kind status-or-amount unjudged`, in text order. */
  const shapes = (content: string) =>
    regexClaims([evidenceMessageFactory.build({ content })]).map((c) =>
      [
        c.kind,
        c.kind === 'operation_status' ? c.status : 'amountCents' in c ? c.amountCents : c.reference,
        c.unjudged,
      ].join(' '),
    );

  it('should bind each status to the amount of its own clause', () => {
    // Arrange
    const content = 'Your previous EUR 6 payment failed, but the EUR 85 transfer completed.';
    // Act
    const claims = regexClaims([evidenceMessageFactory.build({ content })]);
    // Assert
    assert.deepEqual(
      claims.map((c) => [c.kind, 'amountCents' in c ? c.amountCents : null, c.unjudged]),
      [
        ['amount', 600, null],
        ['operation_status', 600, null],
        ['amount', 8500, null],
        ['operation_status', 8500, null],
      ],
    );
  });

  it('should bind a status to the reference of its clause', () => {
    // Arrange
    const content = 'Your transfer ref-historic-lucia was completed.';
    // Act
    const claims = regexClaims([evidenceMessageFactory.build({ content })]);
    // Assert
    assert.deepEqual(
      claims.map((c) => [c.kind, 'reference' in c ? c.reference : null]),
      [
        ['reference', 'ref-historic-lucia'],
        ['operation_status', 'ref-historic-lucia'],
      ],
    );
  });

  for (const content of [
    'The transfer will be completed once you confirm.',
    'Your transfer is pending your confirmation.',
    'When it has been sent, you will get a notification.',
    "I can't confirm whether your transfer was completed.",
    "I don't know if it completed yet.",
    'I cannot tell you whether it went through.',
    'If the transfer failed, you will get the money back.',
    'Your transfer failed? Let me check.',
    'Has your transfer completed?',
    "It's not true that it hasn't been sent.",
    'Your transfer was completed with no delay.',
    'I expect your transfer was completed.',
  ]) {
    it(`should claim ${JSON.stringify(content)} as an ambiguous status`, () => {
      // Arrange
      const message = content;
      // Act
      const found = shapes(message);
      // Assert
      assert.deepEqual(found, ['operation_status ambiguous_status ambiguous_status']);
    });
  }

  for (const content of [
    'Your identity verification is pending.',
    'Your card activation failed.',
    "It wasn't sent.",
  ]) {
    it(`should mark the status of ${JSON.stringify(content)} as about no transfer`, () => {
      // Arrange
      const message = content;
      // Act
      const found = shapes(message);
      // Assert
      assert.equal(found.length, 1);
      assert.match(found[0], /^operation_status \w+ no_subject_found$/);
    });
  }

  it('should mark an amount with no judged status or transfer reference beside it as unanchored', () => {
    // Arrange
    const content =
      'Your transfer of EUR 85 to Bruno went through, and remember the Aurora fee is EUR 6.';
    // Act
    const found = shapes(content);
    // Assert
    assert.deepEqual(found, [
      'amount 8500 ',
      'operation_status completed ',
      'amount 600 unanchored_amount',
    ]);
  });

  it('should mark a fee quoted beside a reference as unanchored', () => {
    // Arrange
    const content = 'Your fee is EUR 6 (ref-historic-lucia).';
    // Act
    const found = shapes(content);
    // Assert
    assert.deepEqual(found, ['amount 600 unanchored_amount', 'reference ref-historic-lucia ']);
  });

  it('should anchor an amount on the transfer reference of its clause', () => {
    // Arrange
    const content = 'The payment ref-historic-lucia was for EUR 60.';
    // Act
    const found = shapes(content);
    // Assert
    assert.deepEqual(found, ['reference ref-historic-lucia ', 'amount 6000 ']);
  });

  it('should keep a status beside an amount it does not judge unanchored', () => {
    // Arrange
    const content = 'Your monthly fee of EUR 6 is pending.';
    // Act
    const found = shapes(content);
    // Assert
    assert.deepEqual(found, [
      'amount 600 unanchored_amount',
      'operation_status pending no_subject_found',
    ]);
  });
});

describe('coverageNet', () => {
  it('should catch an amount the extractor left out of a message', () => {
    // Arrange
    const message = evidenceMessageFactory.build({
      id: 'm3',
      content: 'It was completed: EUR 85.',
    });
    const extracted = regexClaims([message]).filter((c) => c.kind === 'operation_status');
    // Act
    const net = coverageNet([message], extracted);
    // Assert
    assert.deepEqual(
      net.map((c) => [c.id, c.kind]),
      [['m3#net-0', 'amount']],
    );
  });

  it('should add nothing when every value was extracted', () => {
    // Arrange
    const message = evidenceMessageFactory.build({ content: 'It was completed: EUR 85.' });
    // Act
    const net = coverageNet([message], regexClaims([message]));
    // Assert
    assert.deepEqual(net, []);
  });
});
