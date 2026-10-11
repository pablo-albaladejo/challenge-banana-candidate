import { BankFailure } from '../../../shared/domain/bank-failure';
import { requireCase, requireOperator, type IncidentRow } from '../../domain/incident';
import { isAgentEvent, operationsInWindow, type CaseEvidence } from '../../domain/case-evidence';
import { caseDateOf } from '../../domain/case-format';
import type { IncidentRepository } from '../ports/incident-repository';
import type { People } from '../ports/people';
import type { ConversationHistory } from '../ports/conversation-history';
import type { EventReader } from '../ports/event-reader';
import type { ConversationTransfers } from '../ports/conversation-transfers';
import type { OperatorBank } from '../ports/operator-bank';

type Deps = {
  people: People;
  incidents: IncidentRepository;
  history: ConversationHistory;
  events: EventReader;
  transfers: ConversationTransfers;
  bank: OperatorBank;
};

type BankRead<T> = { answer: T } | { failure: 'unreachable' | 'refused' };

/**
 * The bank's answer, or why it gave none: `unreachable` (no answer, a 5xx) or `refused` (it
 * answered with an error). Only a `BankFailure` is a gap; any other error propagates.
 */
async function bankRead<T>(call: () => Promise<T>): Promise<BankRead<T>> {
  try {
    return { answer: await call() };
  } catch (e) {
    if (e instanceof BankFailure)
      return { failure: e.reason === 'unreachable' ? 'unreachable' : 'refused' };
    throw e;
  }
}
const answerOf = <T>(read: BankRead<T>) => ('answer' in read ? read.answer : null);
/** An event's stored JSON, or `null` when it is malformed: one bad row never fails the brief. */
const parsed = (data: string): unknown => {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

/**
 * The evidence of a case, gathered by code with no model (plan Part 2 §4.A.3): the person behind
 * `operatorId` must be an operator, checked before the case is read; then the conversation, the
 * agent's events, the intents after reconcile (stale `processing` ones too), the customer's bank
 * operations of the case window, their contacts and movements (the three bank reads run
 * concurrently), and the earlier closed cases. A bank list that could not be read is `null`, never
 * `[]`, and `bankFailure` says whether the bank was unreachable or refused.
 */
export const makeCaseFacts =
  ({ people, incidents, history, events, transfers, bank }: Deps) =>
  async ({
    operatorId,
    incidentId,
  }: {
    operatorId: string;
    incidentId: string;
  }): Promise<{ incident: IncidentRow; evidence: CaseEvidence }> => {
    requireOperator(people.find(operatorId));
    const incident = requireCase(incidents.byId(incidentId));
    const { user_id: customerId, conversation_id: conversationId } = incident;
    const conversation = history.conversation(conversationId, customerId);
    const messages = history.messagesIn(conversationId);
    const recorded = events
      .inConversation(conversationId)
      .filter(isAgentEvent)
      .map((e) => ({ id: e.id, kind: e.kind, created_at: e.created_at, data: parsed(e.data) }));
    let intents = await transfers.reconcileAndList(customerId, conversationId);
    // `reconcileAndList` checks `unknown` and `failed` only; a `processing` intent left behind by a
    // dispatch that never finished is checked here, and only once it is stale.
    const processing = intents.filter((i) => i.status === 'processing');
    for (const { id } of processing) await transfers.reconcile(customerId, id);
    if (processing.length) intents = await transfers.reconcileAndList(customerId, conversationId);
    const customerIntents = transfers.customerIntents(customerId);
    // The three bank reads are independent: all start at once.
    const [customerRead, contacts, movements] = await Promise.all([
      bankRead(() => bank.customer(operatorId, customerId)),
      bankRead(() => bank.contactsOf(customerId)),
      bankRead(() => bank.movementsOf(customerId)),
    ]);
    const record = answerOf(customerRead);
    return {
      incident,
      evidence: {
        incident: { id: incident.id, created_at: incident.created_at },
        customer: { id: customerId, name: people.find(customerId)?.name ?? customerId },
        conversation: { id: conversation.id, created_at: conversation.created_at },
        messages: messages.map(({ id, role, content, created_at }) => ({
          id,
          role,
          content,
          created_at,
        })),
        events: recorded,
        intents: intents.map(({ id, status, bank_reference, payload, created_at }) => ({
          id,
          status,
          bank_reference,
          payload,
          created_at,
        })),
        customerReferences: customerIntents.flatMap(({ id, bank_reference }) =>
          bank_reference ? [{ id, bank_reference }] : [],
        ),
        allOperations: record
          ? operationsInWindow(
              record.operations,
              customerId,
              customerIntents,
              intents.map((i) => i.id),
              conversation,
              messages,
            )
          : null,
        bankFailure: 'failure' in customerRead ? customerRead.failure : null,
        accounts: record?.accounts.map(({ id, label }) => ({ id, label })) ?? null,
        contacts: answerOf(contacts),
        movements: answerOf(movements),
        previousCases: incidents.closedIn(conversationId),
        caseDate: caseDateOf(incident.created_at),
      },
    };
  };
export type CaseFacts = ReturnType<typeof makeCaseFacts>;
