import type { MessageRepository } from '../ports/message-repository';

/** A conversation's messages in time order. No ownership check: callers check it first. */
export const makeListMessages =
  ({ messages }: { messages: MessageRepository }) =>
  ({ conversationId }: { conversationId: string }) =>
    messages.in(conversationId);
