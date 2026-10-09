import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../../auth';
import { runTool } from '../../agent/tools';
import { conversationFor } from './conversations';
import { json } from '../respond';
import type { Handler } from '../context';
const actionSchema = z.object({
  name: z.enum([
    'transfer_money',
    'request_human',
    'operation_status',
    'list_accounts',
    'search_documents',
  ]),
  arguments: z.unknown(),
  conversationId: z.string().nullable().optional(),
  intentId: z.string().max(150).optional(),
});
/** The body is validated before the role check, so an operator's invalid body is a 400. */
export const runAction: Handler = async ({ request, actor }) => {
  const body = actionSchema.parse(await request.json());
  if (actor.role !== 'customer') throw new HttpError(403, 'A customer is required.');
  if (body.conversationId) conversationFor(body.conversationId, actor.id);
  const ctx = {
    userId: actor.id,
    conversationId: body.conversationId || null,
    runId: randomUUID(),
    intentId: body.intentId || randomUUID(),
  };
  return json(await runTool(body.name, body.arguments, ctx));
};
