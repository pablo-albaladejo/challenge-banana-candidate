import { incidentById } from '../persistence/incidents';
import { messagesIn } from '../persistence/messages';
import { eventsIn } from '../persistence/events';
import { intentsIn, unsettledIntentIds } from '../persistence/intents';
import { person } from '../people';
import { HttpError } from '../auth';
import { operatorCustomer } from '../banking/bank';
import { reconcileIntent } from '../banking/reconcile';
type BankOperation = { id: string; reference: string; status: string; amountCents: number };
/**
 * Everything an operator needs to understand a case: the conversation, what the agent did, the
 * intents it created, and what the bank verified. Evidence that was never recorded is named in
 * `gaps`, never invented.
 */
export async function caseDetail(operatorId: string, id: string) {
  if (person(operatorId)?.role !== 'operator') throw new HttpError(403, 'Operator role required.');
  const incident = incidentById(id);
  if (!incident) throw new HttpError(404, 'Case not found.');
  const history = messagesIn(incident.conversation_id);
  const events = eventsIn(incident.conversation_id).map((e) => ({
    ...e,
    data: JSON.parse(e.data),
  }));
  const pending = unsettledIntentIds(incident.conversation_id);
  for (const { id: intentId } of pending) await reconcileIntent(incident.user_id, intentId);
  const intents = intentsIn(incident.conversation_id).map((i) => ({
    ...i,
    payload: JSON.parse(i.payload),
  }));
  const gaps: string[] = [];
  if (!events.length) gaps.push('No agent activity was recorded for this conversation.');
  let bank: { operations: BankOperation[] } | null = null;
  try {
    const customer = await operatorCustomer(operatorId, incident.user_id);
    const references = new Set(intents.map((i) => i.bank_reference).filter(Boolean));
    bank = { operations: customer.operations.filter((o) => references.has(o.reference)) };
  } catch {
    gaps.push('The bank could not be reached, so its operations are not shown.');
  }
  return {
    incident,
    customer: person(incident.user_id),
    lastMessage: history.at(-1),
    history,
    events,
    intents,
    bank,
    gaps: gaps.length ? gaps.join(' ') : null,
  };
}
