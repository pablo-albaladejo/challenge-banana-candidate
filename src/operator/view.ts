import { appDb } from '../db';
import { person } from '../people';
import { HttpError } from '../auth';
import { bankRequest } from '../banking/client';
type Incident = {
  id: string;
  user_id: string;
  conversation_id: string;
  summary: string;
  status: string;
  created_at: string;
};
type Message = { id: string; role: string; content: string; created_at: string };
type EventRow = { id: string; kind: string; data: string; created_at: string };
type IntentRow = { id: string; status: string; payload: string; bank_reference: string | null };
type BankOperation = { id: string; reference: string; status: string; amountCents: number };
/**
 * Everything an operator needs to understand a case: the conversation, what the agent did, the
 * intents it created, and what the bank verified. Evidence that was never recorded is named in
 * `gaps`, never invented.
 */
export async function caseDetail(operatorId: string, id: string) {
  if (person(operatorId)?.role !== 'operator') throw new HttpError(403, 'Operator role required.');
  const db = appDb();
  const incident = db.prepare('SELECT * FROM incidents WHERE id=?').get(id) as Incident | undefined;
  if (!incident) throw new HttpError(404, 'Case not found.');
  const history = db
    .prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,rowid')
    .all(incident.conversation_id) as Message[];
  const events = (
    db
      .prepare('SELECT * FROM events WHERE conversation_id=? ORDER BY created_at,rowid')
      .all(incident.conversation_id) as EventRow[]
  ).map((e) => ({ ...e, data: JSON.parse(e.data) }));
  const intents = (
    db
      .prepare('SELECT * FROM intents WHERE conversation_id=? ORDER BY created_at')
      .all(incident.conversation_id) as IntentRow[]
  ).map((i) => ({ ...i, payload: JSON.parse(i.payload) }));
  const gaps: string[] = [];
  if (!events.length) gaps.push('No agent activity was recorded for this conversation.');
  let bank: { operations: BankOperation[] } | null = null;
  try {
    const customer = await bankRequest<{ operations: BankOperation[] }>(
      operatorId,
      `/v1/operator/customer?id=${encodeURIComponent(incident.user_id)}`,
    );
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
