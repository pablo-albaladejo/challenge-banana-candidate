import { NEW_CONVERSATION_TITLE } from '../../domain/conversation';
import type { Clock } from '../../../shared/ports/clock';
import type { Ids } from '../../../shared/ports/ids';
import type { ConversationRepository } from '../ports/conversation-repository';

/** An untitled conversation owned by `userId`, started now. The caller gates the role. */
export const makeStartConversation =
  ({
    conversations,
    clock,
    ids,
  }: {
    conversations: ConversationRepository;
    clock: Clock;
    ids: Ids;
  }) =>
  ({ userId }: { userId: string }) => {
    const id = ids.uuid();
    conversations.insert({
      id,
      userId,
      title: NEW_CONVERSATION_TITLE,
      createdAt: clock.now().toISOString(),
    });
    return { id };
  };
