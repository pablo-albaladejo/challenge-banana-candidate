/** A message of the case conversation, as the conversations vertical answers it. */
export type CaseMessage = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  run_id: string | null;
};
/** The conversation of a case. Wired to `conversations().listMessages`. */
export type ConversationHistory = {
  /** Every message of the conversation, in time order. */
  messagesIn(conversationId: string): CaseMessage[];
};
