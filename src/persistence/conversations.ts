import { appDb } from '../db';
export type ConversationRow = { id: string; user_id: string; title: string; created_at: string };
export type NewConversation = { id: string; userId: string; title: string; createdAt: string };
export function insertConversation(c: NewConversation) {
  appDb()
    .prepare('INSERT INTO conversations(id,user_id,title,created_at) VALUES(?,?,?,?)')
    .run(c.id, c.userId, c.title, c.createdAt);
}
/** The conversation, only when `userId` owns it. */
export function conversationOf(id: string, userId: string) {
  return appDb().prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(id, userId) as
    ConversationRow | undefined;
}
/** A customer's conversations, newest first. */
export function conversationsOf(userId: string) {
  return appDb()
    .prepare('SELECT * FROM conversations WHERE user_id=? ORDER BY created_at DESC')
    .all(userId) as ConversationRow[];
}
export function renameConversation(id: string, title: string) {
  appDb().prepare('UPDATE conversations SET title=? WHERE id=?').run(title, id);
}
