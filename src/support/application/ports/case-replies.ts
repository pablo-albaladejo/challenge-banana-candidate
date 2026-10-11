/** The operator's reply, as it is posted in the case conversation. */
export type OperatorReply = {
  id: string;
  conversationId: string;
  role: 'operator';
  content: string;
  /** The operator who wrote it: the customer's chat signs it with their first name. */
  authorId: string;
  createdAt: string;
  runId: null;
};
/** Where a support reply reaches the customer. Wired to `conversations().appendMessage`. */
export type CaseReplies = {
  /** Stores the reply in the conversation, synchronously: it runs inside the closing transaction. */
  append(reply: OperatorReply): void;
};
