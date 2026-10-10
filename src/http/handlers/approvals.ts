import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../../auth';
import { approvalOf } from '../../persistence/approvals';
import { intentOf } from '../../persistence/intents';
import { transferMoney } from '../../banking/actions';
import { json } from '../respond';
import type { Handler } from '../context';
/** The optional body: the customer's "send anyway" past a matching pending transfer. */
const confirmSchema = z.object({ overridePendingIntentId: z.string().max(150).optional() });
export const confirmApproval: Handler = async ({ request, params, actor }) => {
  const approval = approvalOf(params.id, actor.id);
  if (!approval) throw new HttpError(404, 'Proposal not found.');
  const intent = intentOf(approval.intent_id, actor.id);
  if (!intent) throw new HttpError(404, 'Intent not found.');
  const text = await request.text();
  const body = confirmSchema.parse(text ? JSON.parse(text) : {});
  return json(
    await transferMoney(
      {
        userId: actor.id,
        conversationId: intent.conversation_id,
        runId: randomUUID(),
        intentId: intent.id,
        approvalId: approval.id,
        overridePendingIntentId: body.overridePendingIntentId,
      },
      JSON.parse(approval.payload),
    ),
  );
};
