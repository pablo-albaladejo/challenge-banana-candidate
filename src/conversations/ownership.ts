import { HttpError } from '../platform/http/http-error';
import { conversationOf } from './conversations.repo';
/** The conversation when the user owns it; anyone else's is reported as not found. */
export function conversationFor(id: string, userId: string) {
  const result = conversationOf(id, userId);
  if (!result) throw new HttpError(404, 'Conversation not found.');
  return result;
}
