import { randomUUID } from 'node:crypto';
import { HttpError } from '../../platform/http/http-error';
import { conversationsOf, insertConversation } from '../conversations.repo';
import { conversationFor } from '../ownership';
import { messagesIn } from '../messages.repo';
import { json } from '../../platform/http/respond';
import type { Handler } from '../../platform/http/context';
function requireCustomer(role: string) {
  if (role !== 'customer') throw new HttpError(403, 'Select a customer to open a chat.');
}
export const createConversation: Handler = ({ actor }) => {
  requireCustomer(actor.role);
  const id = randomUUID();
  insertConversation({
    id,
    userId: actor.id,
    title: 'New conversation',
    createdAt: new Date().toISOString(),
  });
  return json({ id }, 201);
};
export const listConversations: Handler = ({ actor }) => {
  requireCustomer(actor.role);
  return json(conversationsOf(actor.id));
};
export const conversationDetail: Handler = ({ params, actor }) => {
  const conversation = conversationFor(params.id, actor.id);
  return json({ conversation, messages: messagesIn(params.id) });
};
