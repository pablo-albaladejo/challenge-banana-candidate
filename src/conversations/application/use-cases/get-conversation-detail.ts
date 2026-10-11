import { requireOwned } from '../../domain/conversation';
import type { ConversationRepository } from '../ports/conversation-repository';
import type { MessageRepository } from '../ports/message-repository';

/** An owned conversation with its messages in time order; ownership is checked first. */
export const makeGetConversationDetail =
  ({
    conversations,
    messages,
  }: {
    conversations: ConversationRepository;
    messages: MessageRepository;
  }) =>
  ({ conversationId, userId }: { conversationId: string; userId: string }) => {
    const conversation = requireOwned(conversations.ownedBy(conversationId, userId));
    return { conversation, messages: messages.in(conversationId) };
  };
