import { requireCase, requireOperator } from '../../domain/incident';
import { caseGaps, isAgentEvent, operationsFor } from '../../domain/case-evidence';
import type { Operation } from '../../../types';
import type { IncidentRepository } from '../ports/incident-repository';
import type { People } from '../ports/people';
import type { ConversationHistory } from '../ports/conversation-history';
import type { EventReader } from '../ports/event-reader';
import type { ConversationTransfers } from '../ports/conversation-transfers';
import type { OperatorBank } from '../ports/operator-bank';

type Deps = {
  people: People;
  incidents: IncidentRepository;
  history: Pick<ConversationHistory, 'messagesIn'>;
  events: EventReader;
  transfers: Pick<ConversationTransfers, 'reconcileAndList'>;
  bank: Pick<OperatorBank, 'customer'>;
};
/**
 * Everything an operator needs to understand a case: the conversation, what the agent did, the
 * intents it created, and what the bank verified. The person behind `operatorId` must be an
 * operator, checked before the case is read. Evidence that was never recorded is named in `gaps`,
 * never invented.
 */
export const makeGetCaseDetail =
  ({ people, incidents, history, events, transfers, bank }: Deps) =>
  async ({ operatorId, incidentId }: { operatorId: string; incidentId: string }) => {
    requireOperator(people.find(operatorId));
    const incident = requireCase(incidents.byId(incidentId));
    const messages = history.messagesIn(incident.conversation_id);
    // Support's own audit events (`case.*`) are not agent activity.
    const recorded = events
      .inConversation(incident.conversation_id)
      .filter(isAgentEvent)
      .map((e) => ({
        ...e,
        data: JSON.parse(e.data),
      }));
    const intents = await transfers.reconcileAndList(incident.user_id, incident.conversation_id);
    // Signed as the operator; any failure (a synchronous throw, a rejection or reading its answer)
    // is a named gap.
    let verified: { operations: Operation[] } | null = null;
    try {
      const customer = await bank.customer(operatorId, incident.user_id);
      verified = { operations: operationsFor(customer.operations, intents) };
    } catch {
      verified = null;
    }
    return {
      incident,
      customer: people.find(incident.user_id),
      lastMessage: messages.at(-1),
      history: messages,
      events: recorded,
      intents,
      bank: verified,
      gaps: caseGaps({ hasEvents: recorded.length > 0, bankReachable: verified !== null }),
    };
  };
