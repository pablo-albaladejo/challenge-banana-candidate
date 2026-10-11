import { HttpError } from '../../../platform/http/http-error';
import { json } from '../../../platform/http/respond';
import { conversations } from '../dependencies';
import type { Handler } from '../../../platform/http/context';
/** The role gate stays here, before any use case (plan §10.11, C2). */
function requireCustomer(role: string) {
  if (role !== 'customer') throw new HttpError(403, 'Select a customer to open a chat.');
}
export const createConversation: Handler = ({ actor }) => {
  requireCustomer(actor.role);
  return json(conversations().startConversation({ userId: actor.id }), 201);
};
export const listConversations: Handler = ({ actor }) => {
  requireCustomer(actor.role);
  return json(conversations().listConversations({ userId: actor.id }));
};
/** Any role: an operator owns no conversation, so every detail reads as not found. */
export const conversationDetail: Handler = ({ params, actor }) =>
  json(conversations().getConversationDetail({ conversationId: params.id, userId: actor.id }));
