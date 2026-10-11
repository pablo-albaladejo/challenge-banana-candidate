/** One answer at a time per conversation, in this process. */
export type ConversationLocks = {
  /** Takes the conversation's lock; false when another answer holds it. */
  tryAcquire(conversationId: string): boolean;
  release(conversationId: string): void;
};
