import { HttpError } from '../../../platform/http/http-error';
import { json } from '../../../platform/http/respond';
import { support } from '../dependencies';
import type { Handler } from '../../../platform/http/context';
/** The role gate stays here, before any use case (plan §10.11, C2). */
function requireOperator(role: string) {
  if (role !== 'operator') throw new HttpError(403, 'Operator role required.');
}
export const listIncidents: Handler = ({ actor }) => {
  requireOperator(actor.role);
  return json(support().listIncidents());
};
/** The session role is gated here; `GetCaseDetail` checks the person behind `actor.id` again. */
export const incidentDetail: Handler = async ({ params, actor }) => {
  requireOperator(actor.role);
  return json(await support().getCaseDetail({ operatorId: actor.id, incidentId: params.id }));
};
