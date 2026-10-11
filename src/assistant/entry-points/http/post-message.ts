import { z } from 'zod';
import { conversations } from '../../../conversations';
import { assistant } from '../dependencies';
import { json } from '../../../platform/http/respond';
import type { Handler } from '../../../platform/http/context';
const messageSchema = z.object({ content: z.string().trim().min(1).max(8000) });
/** Ownership first, then the body; the title is set before the agent runs, even if it fails. */
export const postMessage: Handler = async ({ request, params, actor }) => {
  const conversation = conversations().getOwnedConversation({
    conversationId: params.id,
    userId: actor.id,
  });
  const { content } = messageSchema.parse(await request.json());
  conversations().titleConversation({ conversation, userId: actor.id, content });
  return json(
    await assistant().sendMessage({ userId: actor.id, conversationId: params.id, content }),
  );
};
