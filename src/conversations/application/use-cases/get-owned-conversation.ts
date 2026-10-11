import { requireOwned } from '../../domain/conversation';
import type { ConversationRepository } from '../ports/conversation-repository';

/** The conversation when `userId` owns it; another's or an unknown one is `NotFoundError`. */
export const makeGetOwnedConversation =
  ({ conversations }: { conversations: ConversationRepository }) =>
  ({ conversationId, userId }: { conversationId: string; userId: string }) =>
    requireOwned(conversations.ownedBy(conversationId, userId));
