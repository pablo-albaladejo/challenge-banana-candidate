import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appDb } from '../platform/db/db';
import { allIncidents, incidentById, insertIncident, openIncidentIn } from './incidents.repo';
import { incidentFactory } from '../../tests/fixtures/factories';

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
});
