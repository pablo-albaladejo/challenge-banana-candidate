import { statement } from '../../platform/db/statement';
import type { IncidentRow, NewIncident } from '../domain/incident';
import type { IncidentRepository } from '../application/ports/incident-repository';
export function insertIncident(i: NewIncident) {
  statement(
    'INSERT INTO incidents(id,user_id,conversation_id,summary,status,created_at) VALUES(?,?,?,?,?,?)',
  ).run(i.id, i.userId, i.conversationId, i.summary, i.status, i.createdAt);
}
/** Every incident, newest first. */
export function allIncidents() {
  return statement('SELECT * FROM incidents ORDER BY created_at DESC').all() as IncidentRow[];
}
export function incidentById(id: string) {
  return statement('SELECT * FROM incidents WHERE id=?').get(id) as IncidentRow | undefined;
}
/** The open incident of a conversation, if any. */
export function openIncidentIn(conversationId: string) {
  return statement('SELECT id FROM incidents WHERE conversation_id=? AND status=?').get(
    conversationId,
    'open',
  ) as { id: string } | undefined;
}
/** The closed incidents of a conversation, oldest first. */
export function closedIncidentsIn(conversationId: string) {
  return statement(
    'SELECT id, created_at FROM incidents WHERE conversation_id=? AND status=? ORDER BY created_at, id',
  ).all(conversationId, 'closed') as { id: string; created_at: string }[];
}
export const sqliteIncidents: IncidentRepository = {
  insert: insertIncident,
  all: allIncidents,
  byId: incidentById,
  openIn: openIncidentIn,
  closedIn: closedIncidentsIn,
};
