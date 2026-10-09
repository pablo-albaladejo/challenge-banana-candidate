import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { caseDetail } from './view';
import { seedApp } from '../seed';
import { HttpError } from '../auth';
import { config } from '../config';
import { recordEvent } from '../telemetry';
import { resetBank, startBank, stopBank } from '../../tests/support/bank';
const caseId = 'case-routine-lucia-guide';
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
    const operator = 'marta';
    // Act
    const detail = await caseDetail(operator, caseId);
    // Assert
    assert.equal(detail.incident.id, caseId);
    assert.equal(detail.incident.user_id, 'lucia');
    assert.equal(detail.customer?.id, 'lucia');
  });
  it('should include the latest message of the case conversation', async () => {
    // Arrange
    const latest = 'conv-lucia-activity-3-message-2';
    // Act
    const detail = await caseDetail('pablo', caseId);
    // Assert
    assert.equal((detail.lastMessage as { id: string }).id, latest);
  });
  it('should reject customers with 403', async () => {
    // Arrange
    const customer = 'lucia';
    // Act & Assert
    await assert.rejects(caseDetail(customer, caseId), rejectsWith(403));
  });
  it('should reject unknown people with 403', async () => {
    // Arrange
    const stranger = 'mallory';
    // Act & Assert
    await assert.rejects(caseDetail(stranger, caseId), rejectsWith(403));
  });
  it('should report an unknown case as 404', async () => {
    // Arrange
    const missing = 'case-does-not-exist';
    // Act & Assert
    await assert.rejects(caseDetail('marta', missing), rejectsWith(404));
  });
  it('should include the whole case conversation in order', async () => {
    // Arrange
    const expected = [0, 1, 2].map((i) => `conv-lucia-activity-3-message-${i}`);
    // Act
    const detail = await caseDetail('marta', caseId);
    // Assert
    assert.deepEqual(
      detail.history.map((m: { id: string }) => m.id),
      expected,
    );
  });
  it('should include the transfer intents of the case conversation', async () => {
    // Arrange
    const supportCase = 'case-lucia';
    // Act
    const detail = await caseDetail('marta', supportCase);
    // Assert
    assert.deepEqual(
      detail.intents.map((i: { id: string; payload: { amountCents: number } }) => [
        i.id,
        i.payload.amountCents,
      ]),
      [['intent-historic-lucia', 8500]],
    );
  });
  it('should show what the bank verified for each intent reference', async () => {
    // Arrange
    const supportCase = 'case-lucia';
    // Act
    const detail = await caseDetail('marta', supportCase);
    // Assert
    const operation = detail.bank!.operations.find(
      (o: { reference: string }) => o.reference === 'ref-historic-lucia',
    );
    assert.equal(operation?.status, 'completed');
  });
  it('should include the agent events recorded for the case conversation', async () => {
    // Arrange
    recordEvent(
      { userId: 'lucia', conversationId: 'conv-lucia-support', runId: 'run-case', intentId: 'i' },
      'tool.completed',
      { tool: 'list_accounts', status: 'completed' },
    );
    // Act
    const detail = await caseDetail('marta', 'case-lucia');
    // Assert
    assert.ok(
      detail.events.some(
        (e: { kind: string; data: { tool: string } }) =>
          e.kind === 'tool.completed' && e.data.tool === 'list_accounts',
      ),
    );
  });
  it('should name the evidence that was never recorded instead of inventing it', async () => {
    // Arrange
    const quietCase = caseId;
    // Act
    const detail = await caseDetail('marta', quietCase);
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
      detail = await caseDetail('marta', 'case-lucia');
    } finally {
      config.bankUrl = original;
    }
    // Assert
    assert.equal(detail.bank, null);
    assert.match(detail.gaps!, /bank/i);
  });
});
