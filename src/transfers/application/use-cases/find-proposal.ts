import { NotFoundError } from '../../../shared/domain/errors';
import type { ApprovalRepository } from '../ports/approval-repository';
import type { IntentRepository } from '../ports/intent-repository';
type Deps = { approvals: ApprovalRepository; intents: IntentRepository };
/** The customer's proposal and the intent it belongs to, both owned by `userId`. */
export const makeFindProposal =
  ({ approvals, intents }: Deps) =>
  ({ userId, approvalId }: { userId: string; approvalId: string }) => {
    const approval = approvals.ownedBy(approvalId, userId);
    if (!approval) throw new NotFoundError('Proposal not found.');
    const intent = intents.ownedBy(approval.intent_id, userId);
    if (!intent) throw new NotFoundError('Intent not found.');
    return {
      approval: { id: approval.id, payload: approval.payload },
      intent: { id: intent.id, conversationId: intent.conversation_id },
    };
  };
