import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  caseGaps,
  isAgentEvent,
  operationsFor,
  operationsInWindow,
  type WindowOperation,
} from './case-evidence';
import type { Operation } from '../../types';
import { windowOperationFactory } from '../../../tests/fixtures/factories';
import { customers, historicTransfer } from '../../../tests/fixtures/world';

describe('caseGaps', () => {
  it('should report no gap when evidence is complete', () => {
    // Arrange
    const evidence = { hasEvents: true, bankReachable: true };
    // Act
    const gaps = caseGaps(evidence);
    // Assert
    assert.equal(gaps, null);
  });

  it('should name missing agent activity', () => {
    // Arrange
    const evidence = { hasEvents: false, bankReachable: true };
    // Act
    const gaps = caseGaps(evidence);
    // Assert
    assert.equal(gaps, 'No agent activity was recorded for this conversation.');
  });

  it('should name an unreachable bank', () => {
    // Arrange
    const evidence = { hasEvents: true, bankReachable: false };
    // Act
    const gaps = caseGaps(evidence);
    // Assert
    assert.equal(gaps, 'The bank could not be reached, so its operations are not shown.');
  });

  it('should join both gaps with one space', () => {
    // Arrange
    const evidence = { hasEvents: false, bankReachable: false };
    // Act
    const gaps = caseGaps(evidence);
    // Assert
    assert.equal(
      gaps,
      'No agent activity was recorded for this conversation. The bank could not be reached, so its operations are not shown.',
    );
  });
});

describe('operationsFor', () => {
  it('should keep only operations whose reference an intent holds', () => {
    // Arrange
    const operations = [{ reference: 'ref-a' }, { reference: 'ref-b' }, { reference: 'ref-c' }];
    const intents = [
      { bank_reference: 'ref-c' },
      { bank_reference: null },
      { bank_reference: 'ref-a' },
    ];
    // Act
    const kept = operationsFor(operations, intents);
    // Assert
    assert.deepEqual(kept, [{ reference: 'ref-a' }, { reference: 'ref-c' }]);
  });

  it('should keep no operation when no intent reached the bank', () => {
    // Arrange
    const operations = [{ reference: 'ref-a' }];
    const intents = [{ bank_reference: null }];
    // Act
    const kept = operationsFor(operations, intents);
    // Assert
    assert.deepEqual(kept, []);
  });
});

describe('isAgentEvent', () => {
  it('should count tool events as agent activity and support audit events as not', () => {
    // Arrange
    const kinds = ['tool.completed', 'case.brief_generated'];
    // Act
    const agent = kinds.map((kind) => isAgentEvent({ kind }));
    // Assert
    assert.deepEqual(agent, [true, false]);
  });
});

describe('operationsInWindow', () => {
  const conversation = { created_at: '2026-09-23T16:40:00.000Z' };
  const messages = [{ role: 'assistant', created_at: '2026-09-23T16:41:00.000Z' }];
  const booked: Operation = { ...windowOperationFactory.build() };
  delete (booked as Partial<WindowOperation>).linkedIntentId;

  it('should link an operation to the customer intent holding its reference', () => {
    // Arrange
    const intents = [{ id: historicTransfer.intentId, bank_reference: historicTransfer.reference }];
    // Act
    const kept = operationsInWindow(
      [booked],
      customers.lucia,
      intents,
      [historicTransfer.intentId],
      conversation,
      messages,
    );
    // Assert
    assert.deepEqual(kept, [{ ...booked, linkedIntentId: historicTransfer.intentId }]);
  });

  it('should keep an operation no intent holds, unlinked', () => {
    // Arrange
    const intents: { id: string; bank_reference: string | null }[] = [];
    // Act
    const kept = operationsInWindow([booked], customers.lucia, intents, [], conversation, messages);
    // Assert
    assert.equal(kept[0].linkedIntentId, null);
  });

  it('should leave out an operation of another conversation intent', () => {
    // Arrange
    const intents = [{ id: 'intent-elsewhere', bank_reference: historicTransfer.reference }];
    // Act
    const kept = operationsInWindow([booked], customers.lucia, intents, [], conversation, messages);
    // Assert
    assert.deepEqual(kept, []);
  });

  it('should leave out operations before the conversation or a day after its last message', () => {
    // Arrange
    const early = { ...booked, createdAt: '2026-09-23T16:39:59.000Z' };
    const late = { ...booked, createdAt: '2026-09-24T16:41:00.001Z' };
    const operator = [...messages, { role: 'operator', created_at: '2026-09-30T10:00:00.000Z' }];
    // Act
    const kept = operationsInWindow([early, late], customers.lucia, [], [], conversation, operator);
    // Assert
    assert.deepEqual(kept, []);
  });

  it("should keep only the case customer's operations", () => {
    // Arrange
    const someoneElse = { ...booked, id: 'op-someone-else', userId: customers.bruno };
    // Act
    const kept = operationsInWindow(
      [booked, someoneElse],
      customers.lucia,
      [],
      [],
      conversation,
      messages,
    );
    // Assert
    assert.deepEqual(
      kept.map((o) => o.id),
      [booked.id],
    );
  });
});
