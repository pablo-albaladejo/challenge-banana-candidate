import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanAmounts, scanCommitments, scanReferences, scanStatuses } from './scanners';

const centsIn = (text: string) => scanAmounts(text).map((a) => a.cents);
const statusesIn = (text: string) => scanStatuses(text).map((s) => s.status);
const commitmentsIn = (text: string, statements: string[] = []) =>
  scanCommitments(text, statements).map((c) => c.found);

describe('scanAmounts', () => {
  for (const [text, cents] of [
    ['Transfer EUR 85 to Bruno.', 8500],
    ['It costs 85 EUR.', 8500],
    ['It costs €85.', 8500],
    ['It costs € 85.', 8500],
    ['It costs 85 €.', 8500],
    ['It costs 85€.', 8500],
    ['You get 85 euros.', 8500],
    ['You get 1 euro.', 100],
    ['A salary of EUR 1.200,50 arrived.', 120050],
    ['A salary of EUR 1,200.50 arrived.', 120050],
    ['A refund of EUR 85,50 arrived.', 8550],
    ['A salary of EUR 1.200 arrived.', 120000],
    ['A salary of EUR 1,200 arrived.', 120000],
    ['A salary of EUR 1 200 arrived.', 120000],
    ['A limit of EUR 100,000.00 applies.', 10000000],
  ] as const) {
    it(`should read ${JSON.stringify(text)} as ${cents} cents`, () => {
      // Arrange
      const message = text;
      // Act
      const found = centsIn(message);
      // Assert
      assert.deepEqual(found, [cents]);
    });
  }

  it('should report where each amount was found', () => {
    // Arrange
    const text = 'Send EUR 85 now.';
    // Act
    const [amount] = scanAmounts(text);
    // Assert
    assert.equal(text.slice(amount.start, amount.end), amount.found);
    assert.equal(amount.found, 'EUR 85');
  });

  it('should find every amount of a text in order', () => {
    // Arrange
    const text = 'Not EUR 90 but EUR 85.';
    // Act
    const found = centsIn(text);
    // Assert
    assert.deepEqual(found, [9000, 8500]);
  });

  it('should ignore numbers without a currency', () => {
    // Arrange
    const text = 'Within 3 days, on 23 September 2026.';
    // Act
    const found = centsIn(text);
    // Assert
    assert.deepEqual(found, []);
  });
});

describe('scanReferences', () => {
  it('should find bank references and operation ids, lower-cased', () => {
    // Arrange
    const text = 'See ref-historic-lucia and OP-Historic-Lucia.';
    // Act
    const found = scanReferences(text).map((r) => r.value);
    // Assert
    assert.deepEqual(found, ['ref-historic-lucia', 'op-historic-lucia']);
  });
});

describe('scanStatuses', () => {
  it('should read a negated completion as not completed, never as completed', () => {
    // Arrange
    const text = 'The transfer was not completed.';
    // Act
    const found = statusesIn(text);
    // Assert
    assert.deepEqual(found, ['not_completed']);
  });

  it('should read "could not be completed" as not completed', () => {
    // Arrange
    const text = 'The operation could not be completed.';
    // Act
    const found = statusesIn(text);
    // Assert
    assert.deepEqual(found, ['not_completed']);
  });

  it('should read "could not complete" as not completed', () => {
    // Arrange
    const text = 'I could not complete the transfer. You can try again.';
    // Act
    const found = statusesIn(text);
    // Assert
    assert.deepEqual(found, ['not_completed']);
  });

  it('should read "Transfer completed." as completed', () => {
    // Arrange
    const text = 'Transfer completed.';
    // Act
    const found = scanStatuses(text);
    // Assert
    assert.deepEqual(
      found.map((s) => [s.status, s.found]),
      [['completed', 'Transfer completed']],
    );
  });

  it('should read a pending phrase as pending', () => {
    // Arrange
    const text = 'Your transfer is still being verified with the bank.';
    // Act
    const found = statusesIn(text);
    // Assert
    assert.deepEqual(found, ['pending']);
  });

  it('should mark a completion preceded by a negation as an ambiguous status', () => {
    // Arrange
    const text = 'It is not yet completed.';
    // Act
    const found = statusesIn(text);
    // Assert
    assert.deepEqual(found, ['ambiguous_status']);
  });

  for (const text of [
    'Your transfer has not failed.',
    "Your transfer hasn't failed.",
    'Your transfer never failed.',
  ]) {
    it(`should read ${JSON.stringify(text)} as an ambiguous status, never as not completed`, () => {
      // Arrange
      const message = text;
      // Act
      const found = statusesIn(message);
      // Assert
      assert.deepEqual(found, ['ambiguous_status']);
    });
  }

  it('should mark a negated pending phrase as an ambiguous status', () => {
    // Arrange
    const text = 'The transfer is not pending.';
    // Act
    const found = statusesIn(text);
    // Assert
    assert.deepEqual(found, ['ambiguous_status']);
  });

  it('should mark a negated not-completed phrase as an ambiguous status', () => {
    // Arrange
    const text = 'I never said it was not completed.';
    // Act
    const found = statusesIn(text);
    // Assert
    assert.deepEqual(found, ['ambiguous_status']);
  });

  for (const text of [
    "Sorry, your transfer wasn't completed.",
    "The money wasn't sent.",
    'The transfer did not complete.',
    "The transfer didn't complete.",
  ]) {
    it(`should read ${JSON.stringify(text)} as not completed`, () => {
      // Arrange
      const message = text;
      // Act
      const found = statusesIn(message);
      // Assert
      assert.deepEqual(found, ['not_completed']);
    });
  }

  for (const text of [
    'Your transfer has not been completed.',
    "Your transfer hasn't been completed.",
    "The money hasn't been sent.",
    'The money has not been sent.',
    'Your transfer is not completed.',
    'Your transfer was not rejected.',
    "Your transfer wasn't rejected.",
  ]) {
    it(`should read ${JSON.stringify(text)} as an ambiguous status, true of a pending transfer too`, () => {
      // Arrange
      const message = text;
      // Act
      const found = statusesIn(message);
      // Assert
      assert.deepEqual(found, ['ambiguous_status']);
    });
  }

  it("should read a curly apostrophe in couldn't complete as not completed", () => {
    // Arrange
    const text = 'I couldn’t complete it.';
    // Act
    const found = statusesIn(text);
    // Assert
    assert.deepEqual(found, ['not_completed']);
  });
});

describe('scanCommitments', () => {
  for (const [text, found] of [
    ['We will refund you.', 'refund'],
    ['We will reimburse the fee.', 'reimburse'],
    ['You will get compensation.', 'compensation'],
    ['We guarantee it.', 'guarantee'],
    ['We will reverse the payment.', 'reverse'],
    ['We will waive the fee.', 'We will waive'],
    ['We can probably waive it.', 'can probably waive'],
    ['Please try again.', 'try again'],
    ['Please try it again.', 'try it again'],
    ['You may retry later.', 'retry'],
    ['You can resend it.', 'resend'],
    ['You can repeat the transfer.', 'repeat the transfer'],
    ['You can send it again.', 'send it again'],
    ['It arrives within 3 business days.', 'within 3 business days'],
  ] as const) {
    it(`should flag ${JSON.stringify(found)} as a commitment`, () => {
      // Arrange
      const draft = text;
      // Act
      const flagged = commitmentsIn(draft);
      // Assert
      assert.deepEqual(flagged, [found]);
    });
  }

  it('should exempt an instruction not to send the payment again', () => {
    // Arrange
    const draft = 'Please do not send it again.';
    // Act
    const flagged = commitmentsIn(draft);
    // Assert
    assert.deepEqual(flagged, []);
  });

  it('should exempt an instruction never to retry', () => {
    // Arrange
    const draft = 'You should never retry this payment.';
    // Act
    const flagged = commitmentsIn(draft);
    // Assert
    assert.deepEqual(flagged, []);
  });

  it('should accept a descriptive waiver as a statement of the terms', () => {
    // Arrange
    const draft = 'The fee is waived when both requirements are met.';
    // Act
    const flagged = commitmentsIn(draft);
    // Assert
    assert.deepEqual(flagged, []);
  });

  it('should accept a phrase inside a verbatim copy of a fact statement', () => {
    // Arrange
    const statement = 'Refunds are handled by the bank within 3 days.';
    const draft = `As stated: ${statement}`;
    // Act
    const flagged = commitmentsIn(draft, [statement]);
    // Assert
    assert.deepEqual(flagged, []);
  });

  it('should mark the retry phrases among the commitments', () => {
    // Arrange
    const draft = 'Try again, or we will refund you.';
    // Act
    const flagged = scanCommitments(draft, []).map((c) => [c.found, c.retry]);
    // Assert
    assert.deepEqual(flagged, [
      ['Try again', true],
      ['refund', false],
    ]);
  });
});
