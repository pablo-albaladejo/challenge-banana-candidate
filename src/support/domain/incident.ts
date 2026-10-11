import { ForbiddenError, NotFoundError } from '../../shared/domain/errors';
import type { Person } from '../../types';
/** A stored support case, as the `incidents` table holds it (and the API answers it). */
export type IncidentRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  summary: string;
  status: string;
  created_at: string;
};
export type NewIncident = {
  id: string;
  userId: string;
  conversationId: string;
  summary: string;
  status: string;
  createdAt: string;
};
/** The status of a case still waiting for a person. */
export const OPEN = 'open';
/** Only an operator reads a case; a customer or an unknown person is refused. */
export function requireOperator(person: Pick<Person, 'role'> | undefined): void {
  if (person?.role !== 'operator') throw new ForbiddenError('Operator role required.');
}
/** The case; an unknown one is reported as not found. */
export function requireCase<T>(incident: T | undefined): T {
  if (!incident) throw new NotFoundError('Case not found.');
  return incident;
}
