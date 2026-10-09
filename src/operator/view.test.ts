import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { caseDetail } from './view';
import { seedApp } from '../seed';
import { HttpError } from '../auth';
const caseId = 'case-routine-lucia-guide';
const rejectsWith = (status: number) => (e: unknown) => {
  assert.ok(e instanceof HttpError);
  assert.equal(e.status, status);
  return true;
};
describe('caseDetail', () => {
  before(() => seedApp());
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
});
