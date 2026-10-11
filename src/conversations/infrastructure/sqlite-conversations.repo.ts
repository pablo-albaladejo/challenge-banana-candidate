import { statement } from '../../platform/db/statement';
import type { ConversationRow, NewConversation } from '../domain/conversation';
import type { ConversationRepository } from '../application/ports/conversation-repository';
export function insertConversation(c: NewConversation) {
  statement('INSERT INTO conversations(id,user_id,title,created_at) VALUES(?,?,?,?)').run(
    c.id,
    c.userId,
    c.title,
    c.createdAt,
  );
}
/** The conversation, only when `userId` owns it. */
export function conversationOf(id: string, userId: string) {
  return statement('SELECT * FROM conversations WHERE id=? AND user_id=?').get(id, userId) as
    ConversationRow | undefined;
}
/** A customer's conversations, newest first. */
export function conversationsOf(userId: string) {
  return statement('SELECT * FROM conversations WHERE user_id=? ORDER BY created_at DESC').all(
    userId,
  ) as ConversationRow[];
}
/** Renames the conversation, only when `userId` owns it. */
export function renameConversation(id: string, userId: string, title: string) {
  statement('UPDATE conversations SET title=? WHERE id=? AND user_id=?').run(title, id, userId);
}
export const sqliteConversations: ConversationRepository = {
  insert: insertConversation,
  ownedBy: conversationOf,
  ofUser: conversationsOf,
  rename: renameConversation,
};
