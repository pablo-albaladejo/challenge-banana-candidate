import { statement } from '../db/statement';
export type EventRow = {
  id: string;
  run_id: string;
  user_id: string;
  conversation_id: string | null;
  kind: string;
  data: string;
  created_at: string;
};
/** An event to store. `data` is already JSON. */
export type NewEvent = {
  id: string;
  runId: string;
  userId: string;
  conversationId: string | null;
  kind: string;
  data: string;
  createdAt: string;
};
export function insertEvent(e: NewEvent) {
  statement(
    'INSERT INTO events(id,run_id,user_id,conversation_id,kind,data,created_at) VALUES(?,?,?,?,?,?,?)',
  ).run(e.id, e.runId, e.userId, e.conversationId, e.kind, e.data, e.createdAt);
}
/** A conversation's events in recording order. */
export function eventsIn(conversationId: string) {
  return statement('SELECT * FROM events WHERE conversation_id=? ORDER BY created_at,rowid').all(
    conversationId,
  ) as EventRow[];
}
