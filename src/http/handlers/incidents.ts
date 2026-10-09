import { HttpError } from '../../auth';
import { allIncidents } from '../../persistence/incidents';
import { caseDetail } from '../../operator/view';
import { json } from '../respond';
import type { Handler } from '../context';
function requireOperator(role: string) {
  if (role !== 'operator') throw new HttpError(403, 'Operator role required.');
}
export const listIncidents: Handler = ({ actor }) => {
  requireOperator(actor.role);
  return json(allIncidents());
};
export const incidentDetail: Handler = async ({ params, actor }) => {
  requireOperator(actor.role);
  return json(await caseDetail(actor.id, params.id));
};
