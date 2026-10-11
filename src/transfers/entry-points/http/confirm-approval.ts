import { z } from 'zod';
import { json } from '../../../platform/http/respond';
import { transfers } from '../dependencies';
import type { Handler } from '../../../platform/http/context';
/** The optional body: the customer's "send anyway" past a matching pending transfer. */
const confirmSchema = z.object({ overridePendingIntentId: z.string().max(150).optional() });
export const confirmApproval: Handler = async ({ request, params, actor }) => {
  const { approval, intent } = transfers().findProposal({
    userId: actor.id,
    approvalId: params.id,
  });
  const text = await request.text();
  const body = confirmSchema.parse(text ? JSON.parse(text) : {});
  return json(
    await transfers().confirmProposal({
      userId: actor.id,
      approvalId: approval.id,
      intentId: intent.id,
      conversationId: intent.conversationId,
      payload: approval.payload,
      overridePendingIntentId: body.overridePendingIntentId,
    }),
  );
};
