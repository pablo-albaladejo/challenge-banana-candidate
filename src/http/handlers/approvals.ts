import { randomUUID } from 'node:crypto';
import { HttpError } from '../../auth';
import { approvalOf } from '../../persistence/approvals';
import { intentOf } from '../../persistence/intents';
import { transferMoney } from '../../banking/actions';
import { json } from '../respond';
import type { Handler } from '../context';
export const confirmApproval: Handler = async ({ params, actor }) => {
  const approval = approvalOf(params.id, actor.id);
  if (!approval) throw new HttpError(404, 'Proposal not found.');
  const intent = intentOf(approval.intent_id, actor.id);
  if (!intent) throw new HttpError(404, 'Intent not found.');
  return json(
    await transferMoney(
      {
        userId: actor.id,
        conversationId: intent.conversation_id,
        runId: randomUUID(),
        intentId: intent.id,
        approvalId: approval.id,
      },
      JSON.parse(approval.payload),
    ),
  );
};
