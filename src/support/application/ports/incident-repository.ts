import type { IncidentRow, NewIncident } from '../../domain/incident';
/** The stored support cases. No role check here: the use cases and handlers gate the operator. */
export type IncidentRepository = {
  insert(i: NewIncident): void;
  /** Every case, newest first. */
  all(): IncidentRow[];
  byId(id: string): IncidentRow | undefined;
  /** The open case of a conversation, if any. */
  openIn(conversationId: string): { id: string } | undefined;
  /** The closed cases of a conversation, oldest first. */
  closedIn(conversationId: string): { id: string; created_at: string }[];
};
