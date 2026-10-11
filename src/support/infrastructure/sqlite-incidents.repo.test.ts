import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appDb } from '../../platform/db/db';
import {
  allIncidents,
  closeIncident,
  closedIncidentsIn,
  incidentById,
  insertIncident,
  openIncidentIn,
} from './sqlite-incidents.repo';
import { incidentFactory } from '../../../tests/fixtures/factories';
import { operators } from '../../../tests/fixtures/world';

describe('incidents repository', () => {
  beforeEach(() => appDb().exec('DELETE FROM incidents'));
  it('should read back a stored incident', () => {
    // Arrange
    const incident = incidentFactory.build();
    // Act
    insertIncident(incident);
    // Assert
    assert.deepEqual(incidentById(incident.id), {
      id: incident.id,
      user_id: incident.userId,
      conversation_id: incident.conversationId,
      summary: incident.summary,
      status: incident.status,
      created_at: incident.createdAt,
      closed_at: null,
      closed_by: null,
    });
  });
  it('should list every incident newest first', () => {
    // Arrange
    const older = incidentFactory.build({ createdAt: '2026-09-01T10:00:00.000Z' });
    const newer = incidentFactory.build({ createdAt: '2026-09-02T10:00:00.000Z' });
    insertIncident(older);
    insertIncident(newer);
    // Act
    const list = allIncidents();
    // Assert
    assert.deepEqual(
      list.map((i) => i.id),
      [newer.id, older.id],
    );
  });
  it('should find the open incident of a conversation', () => {
    // Arrange
    const open = incidentFactory.build();
    insertIncident(open);
    insertIncident(
      incidentFactory.build({ conversationId: open.conversationId, status: 'closed' }),
    );
    // Act
    const found = openIncidentIn(open.conversationId);
    // Assert
    assert.deepEqual(found, { id: open.id });
  });
  it('should list the closed incidents of a conversation, oldest first', () => {
    // Arrange
    const open = incidentFactory.build();
    const newer = incidentFactory.build({
      conversationId: open.conversationId,
      status: 'closed',
      createdAt: '2026-09-02T10:00:00.000Z',
    });
    const older = incidentFactory.build({
      conversationId: open.conversationId,
      status: 'closed',
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    for (const incident of [open, newer, older]) insertIncident(incident);
    // Act
    const closed = closedIncidentsIn(open.conversationId);
    // Assert
    assert.deepEqual(closed, [
      { id: older.id, created_at: older.createdAt, closed_at: null },
      { id: newer.id, created_at: newer.createdAt, closed_at: null },
    ]);
  });
  it('should close an open incident with when and by whom', () => {
    // Arrange
    const incident = incidentFactory.build();
    insertIncident(incident);
    const closedAt = new Date().toISOString();
    // Act
    const outcome = closeIncident({ id: incident.id, closedAt, closedBy: operators.marta });
    // Assert
    assert.equal(outcome, 'closed');
    assert.deepEqual(incidentById(incident.id), {
      id: incident.id,
      user_id: incident.userId,
      conversation_id: incident.conversationId,
      summary: incident.summary,
      status: 'closed',
      created_at: incident.createdAt,
      closed_at: closedAt,
      closed_by: operators.marta,
    });
    assert.deepEqual(closedIncidentsIn(incident.conversationId), [
      { id: incident.id, created_at: incident.createdAt, closed_at: closedAt },
    ]);
  });
  it('should report a case that is already closed and keep its first closing', () => {
    // Arrange
    const incident = incidentFactory.build();
    insertIncident(incident);
    const first = {
      id: incident.id,
      closedAt: new Date().toISOString(),
      closedBy: operators.marta,
    };
    closeIncident(first);
    // Act
    const outcome = closeIncident({ ...first, closedAt: 'later', closedBy: operators.pablo });
    // Assert
    assert.equal(outcome, 'already_closed');
    assert.equal(incidentById(incident.id)?.closed_at, first.closedAt);
    assert.equal(incidentById(incident.id)?.closed_by, operators.marta);
  });
});
