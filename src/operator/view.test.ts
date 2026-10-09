import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { caseDetail } from './view';
import { seedApp } from '../seed';
import { HttpError } from '../auth';
import { config } from '../config';
import { recordEvent } from '../telemetry';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
import { eventDataFactory, toolContextFactory } from '../../tests/fixtures/factories';
import {
  cases,
  conversations,
  customers,
  historicTransfer,
  operators,
  unknown,
} from '../../tests/fixtures/world';
const caseId = cases.luciaGuide;
const rejectsWith = (status: number) => (e: unknown) => {
  assert.ok(e instanceof HttpError);
  assert.equal(e.status, status);
  return true;
};
describe('caseDetail', () => {
  before(async () => {
    seedApp();
    await startBank();
    await resetBank();
  });
  after(stopBank);
  it('should return the incident and its customer to an operator', async () => {
    // Arrange
    const operator = operators.marta;
    // Act
    const detail = await caseDetail(operator, caseId);
    // Assert
    assert.equal(detail.incident.id, caseId);
    assert.equal(detail.incident.user_id, customers.lucia);
    assert.equal(detail.customer?.id, customers.lucia);
  });
  it('should include the latest message of the case conversation', async () => {
    // Arrange
    const latest = `${conversations.luciaGuide}-message-2`;
    // Act
    const detail = await caseDetail(operators.pablo, caseId);
    // Assert
    assert.equal((detail.lastMessage as { id: string }).id, latest);
  });
  it('should reject customers with 403', async () => {
    // Arrange
    const customer = customers.lucia;
    // Act & Assert
    await assert.rejects(caseDetail(customer, caseId), rejectsWith(403));
  });
  it('should reject unknown people with 403', async () => {
    // Arrange
    const stranger = unknown.person;
    // Act & Assert
    await assert.rejects(caseDetail(stranger, caseId), rejectsWith(403));
  });
  it('should report an unknown case as 404', async () => {
    // Arrange
    const missing = unknown.case;
    // Act & Assert
    await assert.rejects(caseDetail(operators.marta, missing), rejectsWith(404));
  });
  it('should include the whole case conversation in order', async () => {
    // Arrange
    const expected = [0, 1, 2].map((i) => `${conversations.luciaGuide}-message-${i}`);
    // Act
    const detail = await caseDetail(operators.marta, caseId);
    // Assert
    assert.deepEqual(
      detail.history.map((m: { id: string }) => m.id),
      expected,
    );
  });
  it('should include the transfer intents of the case conversation', async () => {
    // Arrange
    const supportCase = cases.lucia;
    // Act
    const detail = await caseDetail(operators.marta, supportCase);
    // Assert
    assert.deepEqual(
      detail.intents.map((i: { id: string; payload: { amountCents: number } }) => [
        i.id,
        i.payload.amountCents,
      ]),
      [[historicTransfer.intentId, historicTransfer.amountCents]],
    );
  });
  it('should show what the bank verified for each intent reference', async () => {
    // Arrange
    const supportCase = cases.lucia;
    // Act
    const detail = await caseDetail(operators.marta, supportCase);
    // Assert
    const operation = detail.bank!.operations.find(
      (o: { reference: string }) => o.reference === historicTransfer.reference,
    );
    assert.equal(operation?.status, 'completed');
  });
  it('should include the agent events recorded for the case conversation', async () => {
    // Arrange
    const data = eventDataFactory.build({ status: 'completed' });
    recordEvent(
      toolContextFactory.build({ conversationId: conversations.luciaSupport }),
      'tool.completed',
      data,
    );
    // Act
    const detail = await caseDetail(operators.marta, cases.lucia);
    // Assert
    assert.ok(
      detail.events.some(
        (e: { kind: string; data: { tool: string } }) =>
          e.kind === 'tool.completed' && e.data.tool === data.tool,
      ),
    );
  });
  it('should name the evidence that was never recorded instead of inventing it', async () => {
    // Arrange
    const quietCase = caseId;
    // Act
    const detail = await caseDetail(operators.marta, quietCase);
    // Assert
    assert.deepEqual(detail.events, []);
    assert.match(detail.gaps!, /no agent activity/i);
  });
  it('should report the bank as unavailable instead of guessing operations', async () => {
    // Arrange
    const original = config.bankUrl;
    config.bankUrl = 'http://127.0.0.1:9';
    // Act
    let detail;
    try {
      detail = await caseDetail(operators.marta, cases.lucia);
    } finally {
      config.bankUrl = original;
    }
    // Assert
    assert.equal(detail.bank, null);
    assert.match(detail.gaps!, /bank/i);
  });
  it('should show a historic intent as the bank verified it', async () => {
    // Arrange
    const supportCase = cases.lucia;
    // Act
    const detail = await caseDetail(operators.marta, supportCase);
    // Assert
    const intent = detail.intents.find((i: { id: string }) => i.id === historicTransfer.intentId)!;
    assert.equal(intent.status, 'completed');
  });
});
