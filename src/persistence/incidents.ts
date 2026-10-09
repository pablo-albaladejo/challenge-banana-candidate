import { appDb } from '../db';
export type IncidentRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  summary: string;
  status: string;
  created_at: string;
};
export type NewIncident = {
  id: string;
  userId: string;
  conversationId: string;
  summary: string;
  status: string;
  createdAt: string;
};
export function insertIncident(i: NewIncident) {
  appDb()
    .prepare(
      'INSERT INTO incidents(id,user_id,conversation_id,summary,status,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(i.id, i.userId, i.conversationId, i.summary, i.status, i.createdAt);
}
/** Every incident, newest first. */
export function allIncidents() {
  return appDb().prepare('SELECT * FROM incidents ORDER BY created_at DESC').all() as IncidentRow[];
}
export function incidentById(id: string) {
  return appDb().prepare('SELECT * FROM incidents WHERE id=?').get(id) as IncidentRow | undefined;
}
/** The open incident of a conversation, if any. */
export function openIncidentIn(conversationId: string) {
  return appDb()
    .prepare('SELECT id FROM incidents WHERE conversation_id=? AND status=?')
    .get(conversationId, 'open') as { id: string } | undefined;
}
