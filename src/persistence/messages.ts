import { statement } from './statement';
export type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  run_id: string | null;
};
export type NewMessage = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
  runId: string | null;
};
export function insertMessage(m: NewMessage) {
  statement(
    'INSERT INTO messages(id,conversation_id,role,content,created_at,run_id) VALUES(?,?,?,?,?,?)',
  ).run(m.id, m.conversationId, m.role, m.content, m.createdAt, m.runId);
}
/** A conversation's messages in time order; equal times keep insertion order. */
export function messagesIn(conversationId: string) {
  return statement('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,rowid').all(
    conversationId,
  ) as MessageRow[];
}
