import { randomIds, systemClock } from '../../platform/runtime';
import { sqliteConversations } from '../infrastructure/sqlite-conversations.repo';
import { sqliteMessages } from '../infrastructure/sqlite-messages.repo';
import { makeStartConversation } from '../application/use-cases/start-conversation';
import { makeListConversations } from '../application/use-cases/list-conversations';
import { makeGetConversationDetail } from '../application/use-cases/get-conversation-detail';
import { makeGetOwnedConversation } from '../application/use-cases/get-owned-conversation';
import { makeTitleConversation } from '../application/use-cases/title-conversation';
import { makeAppendMessage } from '../application/use-cases/append-message';
import { makeListMessages } from '../application/use-cases/list-messages';
import type { Clock } from '../../shared/ports/clock';
import type { Ids } from '../../shared/ports/ids';
import type { ConversationRepository } from '../application/ports/conversation-repository';
import type { MessageRepository } from '../application/ports/message-repository';
export type ConversationsDeps = {
  conversations: ConversationRepository;
  messages: MessageRepository;
  clock: Clock;
  ids: Ids;
};
/**
 * Only the clock and ids may be faked (`StartConversation` reads both). The repos are always the
 * real ones. No `internals`: there is no service and no registry to reach from a test.
 */
export type ConversationsOverrides = Partial<Pick<ConversationsDeps, 'clock' | 'ids'>>;
const defaults = (): ConversationsDeps => ({
  conversations: sqliteConversations,
  messages: sqliteMessages,
  clock: systemClock,
  ids: randomIds,
});
export function wireConversations(overrides: ConversationsOverrides = {}) {
  const deps = { ...defaults(), ...overrides };
  return {
    startConversation: makeStartConversation(deps),
    listConversations: makeListConversations(deps),
    getConversationDetail: makeGetConversationDetail(deps),
    getOwnedConversation: makeGetOwnedConversation(deps),
    titleConversation: makeTitleConversation(deps),
    appendMessage: makeAppendMessage(deps),
    listMessages: makeListMessages(deps),
  };
}
/** What index.ts exposes: the use cases. */
export type ConversationsApp = ReturnType<typeof wireConversations>;
let graph: ConversationsApp | undefined;
export const conversations = (): ConversationsApp => (graph ??= wireConversations());
