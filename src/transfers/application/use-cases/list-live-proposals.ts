import type { Clock } from '../../../shared/ports/clock';
import type { ApprovalRepository } from '../ports/approval-repository';
type Deps = { approvals: ApprovalRepository; clock: Clock };
/** Every proposal of the customer still confirmable at the clock time, its payload parsed. */
export const makeListLiveProposals =
  ({ approvals, clock }: Deps) =>
  ({ userId }: { userId: string }) =>
    approvals.liveOf(userId, clock.now().toISOString()).map((a) => ({
      ...a,
      payload: JSON.parse(a.payload),
    }));
