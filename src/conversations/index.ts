// Public surface of the conversations feature: other features import only from here.
export { conversations, type ConversationsApp } from './entry-points/dependencies';
export {
  conversationDetail,
  createConversation,
  listConversations,
} from './entry-points/http/conversations';
