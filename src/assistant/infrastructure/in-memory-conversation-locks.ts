import type { ConversationLocks } from '../application/ports/conversation-locks';
/** The conversations answering in this process: one per wired graph, emptied by a restart. */
export function inMemoryConversationLocks(): ConversationLocks {
  const locks = new Set<string>();
  return {
    tryAcquire(conversationId) {
      if (locks.has(conversationId)) return false;
      locks.add(conversationId);
      return true;
    },
    release: (conversationId) => void locks.delete(conversationId),
  };
}
