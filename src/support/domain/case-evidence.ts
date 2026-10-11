import type { Operation, TransferInput } from '../../types';
/**
 * What evidence of a case is missing, named in one sentence each and joined by a space; `null`
 * when nothing is. Evidence that was never recorded is named, never invented.
 */
export function caseGaps({
  hasEvents,
  bankReachable,
}: {
  hasEvents: boolean;
  bankReachable: boolean;
}): string | null {
  const gaps: string[] = [];
  if (!hasEvents) gaps.push('No agent activity was recorded for this conversation.');
  if (!bankReachable) gaps.push('The bank could not be reached, so its operations are not shown.');
  return gaps.length ? gaps.join(' ') : null;
}
/** The bank operations whose reference one of the case's intents holds, in the bank's order. */
export function operationsFor<O extends { reference: string }>(
  operations: O[],
  intents: { bank_reference: string | null }[],
): O[] {
  const references = new Set(intents.map((i) => i.bank_reference).filter(Boolean));
  return operations.filter((o) => references.has(o.reference));
}
/**
 * Whether an event records what the agent did. Support's own audit events (`case.*`, such as
 * `case.brief_generated`) are not agent activity.
 */
export const isAgentEvent = (event: { kind: string }) => !event.kind.startsWith('case.');

/** How long after the customer's last message a bank operation still belongs to the case. */
export const OPERATION_WINDOW_MS = 24 * 3600 * 1000;

/** A bank operation of the case window, with the intent of the customer that holds its reference. */
export type WindowOperation = Operation & { linkedIntentId: string | null };

/**
 * The customer's bank operations made between the conversation's start and 24 h after its last
 * customer or assistant message (an operator reply never widens the window); an operation of anyone
 * else is dropped, whatever the bank answered. Each is linked to the
 * customer's intent holding its reference, across all their conversations; an operation linked to
 * another conversation's intent is not evidence here, one linked to none is kept.
 */
export function operationsInWindow(
  operations: Operation[],
  customerId: string,
  customerIntents: { id: string; bank_reference: string | null }[],
  conversationIntentIds: string[],
  conversation: { created_at: string },
  messages: { role: string; created_at: string }[],
): WindowOperation[] {
  const start = Date.parse(conversation.created_at);
  const last = messages.filter((m) => m.role !== 'operator').at(-1);
  const end = Date.parse(last?.created_at ?? conversation.created_at) + OPERATION_WINDOW_MS;
  const own = new Set(conversationIntentIds);
  return operations
    .filter((o) => o.userId === customerId)
    .filter((o) => start <= Date.parse(o.createdAt) && Date.parse(o.createdAt) <= end)
    .map((o) => ({
      ...o,
      linkedIntentId: customerIntents.find((i) => i.bank_reference === o.reference)?.id ?? null,
    }))
    .filter((o) => o.linkedIntentId === null || own.has(o.linkedIntentId));
}

export type EvidenceMessage = { id: string; role: string; content: string; created_at: string };
export type EvidenceIntent = {
  id: string;
  status: string;
  bank_reference: string | null;
  payload: TransferInput;
  created_at: string;
};
export type EvidenceMovement = {
  id: string;
  accountId: string;
  amountCents: number;
  description: string;
  createdAt: string;
};

/**
 * Everything the brief judges, gathered by `case-facts.ts`. A list the bank could not answer is
 * `null`, never `[]`: a missing list is not an empty one.
 */
export type CaseEvidence = {
  incident: { id: string; created_at: string };
  customer: { id: string; name: string };
  conversation: { id: string; created_at: string };
  messages: EvidenceMessage[];
  /** Agent events only (`isAgentEvent`), `data` parsed. */
  events: { id: string; kind: string; created_at: string; data: unknown }[];
  /** The conversation's intents, after reconcile. */
  intents: EvidenceIntent[];
  /** Every intent of the customer holding a bank reference, any conversation. */
  customerReferences: { id: string; bank_reference: string }[];
  allOperations: WindowOperation[] | null;
  /**
   * Why `allOperations` is `null`: the bank could not be reached (or gave no answer), or it
   * answered the request with an error. `null` when the bank answered.
   */
  bankFailure: 'unreachable' | 'refused' | null;
  accounts: { id: string; label: string }[] | null;
  contacts: { id: string; name?: string }[] | null;
  movements: EvidenceMovement[] | null;
  /** The closed cases of the same conversation; `closed_at` is `null` for a seeded one. */
  previousCases: { id: string; created_at: string; closed_at: string | null }[];
  /** `YYYY-MM-DD`: the case's Madrid date, never later than the reference date. */
  caseDate: string;
};
