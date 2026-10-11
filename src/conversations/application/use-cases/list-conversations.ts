import type { ConversationRepository } from '../ports/conversation-repository';

/** The user's own conversations, newest first. The caller gates the role. */
export const makeListConversations =
  ({ conversations }: { conversations: ConversationRepository }) =>
  ({ userId }: { userId: string }) =>
    conversations.ofUser(userId);
