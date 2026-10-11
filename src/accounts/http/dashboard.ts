import * as bank from '../../platform/bank/bank';
import { transfers } from '../../transfers';
import { allIncidents } from '../../support';
import { json } from '../../platform/http/respond';
import type { Handler } from '../../platform/http/context';
export const dashboard: Handler = async ({ actor }) => {
  if (actor.role === 'operator') return json({ incidents: allIncidents() });
  const [accounts, movements, contacts, pending] = await Promise.all([
    bank.accounts(actor.id),
    bank.movements(actor.id),
    bank.contacts(actor.id),
    transfers().listPendingTransfers({ userId: actor.id }),
  ]);
  const approvals = transfers().listLiveProposals({ userId: actor.id });
  return json({ accounts, movements, contacts, approvals, pendingTransfers: pending });
};
