import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkDraft } from './draft-check';
import { verifiedFactFactory } from '../../../tests/fixtures/factories';
import { historicTransfer } from '../../../tests/fixtures/world';

/** The facts of lucia's case: EUR 85, its reference, completed. */
const luciaFacts = () => [
  verifiedFactFactory.build({ kind: 'amount', value: 'EUR 85.00' }),
  verifiedFactFactory.build({ kind: 'reference', value: historicTransfer.reference }),
  verifiedFactFactory.build({ kind: 'status', value: 'completed' }),
];

describe('checkDraft', () => {
  it('should keep every value a fact backs', () => {
    // Arrange
    const draftReply = `Your transfer of EUR 85 (${historicTransfer.reference}) was completed.`;
    // Act
    const result = checkDraft({ draftReply }, luciaFacts(), { substitute: true });
    // Assert
    assert.equal(result.fields.draftReply, draftReply);
    assert.deepEqual(result.flags, []);
  });

  it('should substitute an untraced amount and reference in the reply', () => {
    // Arrange
    const draftReply = 'Your balance shows EUR 30 under ref-x.';
    // Act
    const result = checkDraft({ draftReply }, luciaFacts(), { substitute: true });
    // Assert
    assert.equal(
      result.fields.draftReply,
      'Your balance shows [check: amount] under [check: reference].',
    );
    assert.deepEqual(
      result.flags.map((f) => [f.kind, f.found, f.substituted]),
      [
        ['amount', 'EUR 30', true],
        ['reference', 'ref-x', true],
      ],
    );
  });

  it('should point each flag at its span in the rewritten text', () => {
    // Arrange
    const draftReply = 'EUR 30 and EUR 40.';
    // Act
    const result = checkDraft({ draftReply }, luciaFacts(), { substitute: true });
    // Assert
    const text = result.fields.draftReply!;
    assert.deepEqual(
      result.flags.map((f) => text.slice(f.start, f.end)),
      ['[check: amount]', '[check: amount]'],
    );
  });

  it('should substitute a not-completed status when the bank completed the transfer', () => {
    // Arrange
    const draftReply = 'Your transfer was not completed.';
    // Act
    const result = checkDraft({ draftReply }, luciaFacts(), { substitute: true });
    // Assert
    assert.match(result.fields.draftReply!, /\[check: status\]/);
    assert.doesNotMatch(result.fields.draftReply!, /not completed/);
  });

  it('should substitute a completed status no fact establishes', () => {
    // Arrange
    const draftReply = 'Your transfer was completed.';
    // Act
    const result = checkDraft({ draftReply }, [], { substitute: true });
    // Assert
    assert.match(result.fields.draftReply!, /\[check: status\]/);
    assert.doesNotMatch(result.fields.draftReply!, /completed/);
  });

  it('should flag a promise without rewriting it', () => {
    // Arrange
    const draftReply = 'We will refund you today.';
    // Act
    const result = checkDraft({ draftReply }, luciaFacts(), { substitute: true });
    // Assert
    assert.equal(result.fields.draftReply, draftReply);
    assert.deepEqual(
      result.flags.map((f) => [f.kind, f.substituted]),
      [['commitment', false]],
    );
  });

  it('should only report when asked not to substitute', () => {
    // Arrange
    const draftReply = 'Your balance shows EUR 30.';
    // Act
    const result = checkDraft({ draftReply }, luciaFacts(), { substitute: false });
    // Assert
    assert.equal(result.fields.draftReply, draftReply);
    assert.equal(result.flags[0].substituted, false);
  });

  it('should flag the summary and next step without rewriting them', () => {
    // Arrange
    const fields = { summary: 'She lost EUR 30.', nextStep: 'Check ref-x.' };
    // Act
    const result = checkDraft(fields, luciaFacts(), { substitute: true });
    // Assert
    assert.deepEqual(result.fields, fields);
    assert.deepEqual(
      result.flags.map((f) => f.field),
      ['summary', 'nextStep'],
    );
  });
});
