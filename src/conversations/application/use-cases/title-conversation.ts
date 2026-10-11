import { titleFor } from '../../domain/conversation';
import type { ConversationRow } from '../../domain/conversation';
import type { ConversationRepository } from '../ports/conversation-repository';

/**
 * Names an untitled conversation after a message; a titled one keeps its title. The title is
 * decided from the row `GetOwnedConversation` returned (read before the body, as before the move),
 * and the rename itself is owner-scoped: a row of someone else's conversation renames nothing.
 */
export const makeTitleConversation =
  ({ conversations }: { conversations: ConversationRepository }) =>
  ({
    conversation,
    userId,
    content,
  }: {
    conversation: ConversationRow;
    userId: string;
    content: string;
  }) => {
    const title = titleFor(conversation, content);
    if (title !== undefined) conversations.rename(conversation.id, userId, title);
  };
