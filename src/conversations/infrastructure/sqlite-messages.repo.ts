import { statement } from '../../platform/db/statement';
import type { MessageRow, NewMessage } from '../domain/conversation';
import type { MessageRepository } from '../application/ports/message-repository';
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
export const sqliteMessages: MessageRepository = { insert: insertMessage, in: messagesIn };
