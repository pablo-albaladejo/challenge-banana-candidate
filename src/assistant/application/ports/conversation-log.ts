/** A message the assistant stores; id and createdAt come from `SendMessage`. */
export type LoggedMessage = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
  runId: string | null;
};
/** The conversation the assistant answers in. */
export type ConversationLog = {
  /** Throws `NotFoundError('Conversation not found.')` unless `userId` owns the conversation. */
  requireOwned(conversationId: string, userId: string): void;
  append(m: LoggedMessage): void;
  /** Every message of the conversation, in time order. */
  history(conversationId: string): { role: string; content: string }[];
};
