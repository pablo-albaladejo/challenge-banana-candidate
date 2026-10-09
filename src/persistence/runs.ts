import { statement } from './statement';
export type NewRun = {
  id: string;
  userId: string;
  conversationId: string | null;
  startedAt: string;
  status: string;
  error: string | null;
};
export function insertRun(r: NewRun) {
  statement(
    'INSERT INTO runs(id,user_id,conversation_id,started_at,status,error) VALUES(?,?,?,?,?,?)',
  ).run(r.id, r.userId, r.conversationId, r.startedAt, r.status, r.error);
}
/** Sets the run status; the error is written only when one is given. */
export function setRunStatus(id: string, status: string, error?: string) {
  if (error === undefined) statement('UPDATE runs SET status=? WHERE id=?').run(status, id);
  else statement('UPDATE runs SET status=?,error=? WHERE id=?').run(status, error, id);
}
