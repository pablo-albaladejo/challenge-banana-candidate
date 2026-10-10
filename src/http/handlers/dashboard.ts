import * as bank from '../../banking/bank';
import { liveApprovalsOf } from '../../persistence/approvals';
import { allIncidents } from '../../persistence/incidents';
import { json } from '../respond';
import type { Handler } from '../context';
export const dashboard: Handler = async ({ actor }) => {
  if (actor.role === 'operator') return json({ incidents: allIncidents() });
  const [accounts, movements, contacts] = await Promise.all([
    bank.accounts(actor.id),
    bank.movements(actor.id),
    bank.contacts(actor.id),
  ]);
  const approvals = liveApprovalsOf(actor.id, new Date().toISOString()).map((a) => ({
    ...a,
    payload: JSON.parse(a.payload),
  }));
  return json({ accounts, movements, contacts, approvals });
};
