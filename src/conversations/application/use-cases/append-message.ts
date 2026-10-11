import type { NewMessage } from '../../domain/conversation';
import type { MessageRepository } from '../ports/message-repository';

/** Stores a message as given (id, time and run come from the caller, which checked ownership). */
export const makeAppendMessage =
  ({ messages }: { messages: MessageRepository }) =>
  (message: NewMessage) =>
    messages.insert(message);
