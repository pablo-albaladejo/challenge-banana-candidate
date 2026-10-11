import { NotFoundError } from '../../shared/domain/errors';
/** A stored conversation, as the `conversations` table holds it (and the API answers it). */
export type ConversationRow = { id: string; user_id: string; title: string; created_at: string };
export type NewConversation = { id: string; userId: string; title: string; createdAt: string };
/**
 * A stored message, as the `messages` table holds it (and the API answers it). `role` is `user`,
 * `assistant` or `operator` (a support reply, which closed a case; written only by support).
 */
export type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  run_id: string | null;
  /** Who wrote it: the operator of an `operator` message; `null` for the customer and the assistant. */
  author_id: string | null;
};
export type NewMessage = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
  runId: string | null;
  /** The operator who wrote an `operator` message (support's reply); absent or `null` otherwise. */
  authorId?: string | null;
};
/** The title of a conversation until its first message names it. */
export const NEW_CONVERSATION_TITLE = 'New conversation';
/** The new title when the conversation is still untitled: the first 50 characters; else none. */
export function titleFor(conversation: { title: string }, content: string): string | undefined {
  return conversation.title === NEW_CONVERSATION_TITLE ? content.slice(0, 50) : undefined;
}
/** The conversation the user owns; anyone else's (or an unknown one) is reported as not found. */
export function requireOwned<T>(conversation: T | undefined): T {
  if (!conversation) throw new NotFoundError('Conversation not found.');
  return conversation;
}
