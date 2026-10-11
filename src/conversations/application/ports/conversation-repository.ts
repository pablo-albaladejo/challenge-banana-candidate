import type { ConversationRow, NewConversation } from '../../domain/conversation';
/** The stored conversations. Ownership is part of the lookup: `ownedBy` never returns another's. */
export type ConversationRepository = {
  insert(c: NewConversation): void;
  /** The conversation, only when `userId` owns it. */
  ownedBy(id: string, userId: string): ConversationRow | undefined;
  /** A customer's conversations, newest first. */
  ofUser(userId: string): ConversationRow[];
  /** Renames the conversation only when `userId` owns it; anyone else's is left as it was. */
  rename(id: string, userId: string, title: string): void;
};
