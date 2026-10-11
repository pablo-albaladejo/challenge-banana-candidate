import { BadRequestError, ConflictError } from '../../../shared/domain/errors';
import { CLOSED, OPEN, requireCase, requireOperator } from '../../domain/incident';
import { verifyClaim } from '../../domain/claim-verification';
import { verifiedFacts } from '../../domain/verified-facts';
import { regexClaims } from '../../domain/regex-claims';
import { checkDraft, type DraftFlag } from '../../domain/draft-check';
import type { Clock } from '../../../shared/ports/clock';
import type { Ids } from '../../../shared/ports/ids';
import type { UnitOfWork } from '../../../shared/ports/unit-of-work';
import type { CaseFacts } from '../services/case-facts';
import type { CaseEvents } from '../ports/case-events';
import type { CaseReplies } from '../ports/case-replies';
import type { IncidentRepository } from '../ports/incident-repository';
import type { People } from '../ports/people';

type Deps = {
  people: People;
  incidents: IncidentRepository;
  caseFacts: CaseFacts;
  replies: CaseReplies;
  caseEvents: CaseEvents;
  unitOfWork: UnitOfWork;
  clock: Clock;
  ids: Ids;
};

export type ReplyAndCloseCommand = {
  operatorId: string;
  incidentId: string;
  content: string;
  acknowledgeUnverified?: boolean;
};

export type ReplyAndCloseResult =
  | {
      /** Nothing was written: the operator must acknowledge the flags and send again. */
      status: 'needs_acknowledgement';
      flags: DraftFlag[];
      /** The bank could not be read, so no amount, reference or status could be checked. */
      bankUnreachable: boolean;
    }
  | {
      status: 'closed';
      incident: { id: string; status: typeof CLOSED; closedAt: string; closedBy: string };
      message: {
        id: string;
        conversation_id: string;
        role: 'operator';
        content: string;
        created_at: string;
        run_id: null;
        author_id: string;
      };
    };

/**
 * Sends the operator's reply to the customer and closes the case (plan Part 2 §4.A.9). The person
 * behind `operatorId` must be an operator, checked before the case is read; a reply that still
 * holds a `[check: …]` placeholder is refused whatever the acknowledgement says. The facts are
 * recomputed by code, with no model call, and the reply is checked against them without rewriting
 * it: an untraced amount, reference or status, an ambiguous status or a promise answers
 * `needs_acknowledgement` until the operator acknowledges it. Then, in one transaction, the case
 * is closed only if it is still open, the reply is posted in the case's own conversation as an
 * `operator` message, and `case.replied` is recorded.
 */
export const makeReplyAndCloseCase =
  ({ people, incidents, caseFacts, replies, caseEvents, unitOfWork, clock, ids }: Deps) =>
  async ({
    operatorId,
    incidentId,
    content,
    acknowledgeUnverified,
  }: ReplyAndCloseCommand): Promise<ReplyAndCloseResult> => {
    requireOperator(people.find(operatorId));
    if (requireCase(incidents.byId(incidentId)).status !== OPEN)
      throw new ConflictError('This case is already closed.');
    if (content.includes('[check:'))
      throw new BadRequestError('Replace every [check: …] placeholder before sending.');
    const { incident, evidence } = await caseFacts({ operatorId, incidentId });
    const claims = regexClaims(evidence.messages);
    const { facts } = verifiedFacts(
      evidence,
      claims,
      claims.map((c) => verifyClaim(c, evidence)),
    );
    const { flags } = checkDraft({ draftReply: content }, facts, { substitute: false });
    const bankUnreachable = evidence.allOperations === null;
    const acknowledged = acknowledgeUnverified === true;
    if (flags.length && !acknowledged)
      return { status: 'needs_acknowledgement', flags, bankUnreachable };
    const closedAt = clock.now().toISOString();
    const reply = {
      id: ids.uuid(),
      conversationId: incident.conversation_id,
      role: 'operator' as const,
      content,
      authorId: operatorId,
      createdAt: closedAt,
      runId: null,
    };
    unitOfWork.atomically(() => {
      if (incidents.close({ id: incident.id, closedAt, closedBy: operatorId }) !== CLOSED)
        throw new ConflictError('This case is already closed.');
      replies.append(reply);
      caseEvents.replied({
        id: ids.uuid(),
        operatorId,
        incidentId: incident.id,
        messageId: reply.id,
        evidence,
        flags,
        acknowledged,
        bankUnreachable,
        createdAt: closedAt,
      });
    });
    return {
      status: CLOSED,
      incident: { id: incident.id, status: CLOSED, closedAt, closedBy: operatorId },
      message: {
        id: reply.id,
        conversation_id: reply.conversationId,
        role: reply.role,
        content,
        created_at: closedAt,
        run_id: null,
        author_id: operatorId,
      },
    };
  };
export type ReplyAndCloseCase = ReturnType<typeof makeReplyAndCloseCase>;
