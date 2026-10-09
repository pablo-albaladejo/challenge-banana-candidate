import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../../auth';
import {
  conversationOf,
  conversationsOf,
  insertConversation,
  renameConversation,
} from '../../persistence/conversations';
import { messagesIn } from '../../persistence/messages';
import { sendMessage } from '../../agent/run';
import { json } from '../respond';
import type { Handler } from '../context';
const messageSchema = z.object({ content: z.string().trim().min(1).max(8000) });
/** The conversation when the user owns it; anyone else's is reported as not found. */
export function conversationFor(id: string, userId: string) {
  const result = conversationOf(id, userId);
  if (!result) throw new HttpError(404, 'Conversation not found.');
  return result;
}
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
/** Ownership first, then the body; the title is set before the agent runs, even if it fails. */
export const postMessage: Handler = async ({ request, params, actor }) => {
  const conversation = conversationFor(params.id, actor.id);
  const { content } = messageSchema.parse(await request.json());
  if (conversation.title === 'New conversation')
    renameConversation(params.id, content.slice(0, 50));
  return json(await sendMessage(actor.id, params.id, content));
};
export const conversationDetail: Handler = ({ params, actor }) => {
  const conversation = conversationFor(params.id, actor.id);
  return json({ conversation, messages: messagesIn(params.id) });
};
