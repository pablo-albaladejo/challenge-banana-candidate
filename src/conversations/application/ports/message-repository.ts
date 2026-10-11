import type { MessageRow, NewMessage } from '../../domain/conversation';
/** The stored messages. No ownership here: callers check the conversation first. */
export type MessageRepository = {
  insert(m: NewMessage): void;
  /** A conversation's messages in time order; equal times keep insertion order. */
  in(conversationId: string): MessageRow[];
};
