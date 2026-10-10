import * as bank from '../../platform/bank/bank';
import { intentById, liveApprovalsOf, pendingIntentsOf, reconcileIntent } from '../../transfers';
import { allIncidents } from '../../support';
import { json } from '../../platform/http/respond';
import type { Handler } from '../../platform/http/context';
/** How many unsettled transfers one dashboard load checks with the bank. */
const PENDING_TRANSFERS_LIMIT = 10;
/**
 * The customer's latest transfers worth checking (`unknown`, `processing`, and `failed` ones that
 * reached the bank in the last 24 h), each checked with the bank first, so the customer sees the bank's answer instead of a stale "did not confirm". A check that
 * fails leaves its intent as it was; the dashboard still loads.
 */
async function pendingTransfers(userId: string) {
  const pending = pendingIntentsOf(userId, PENDING_TRANSFERS_LIMIT);
  await Promise.allSettled(pending.map((intent) => reconcileIntent(userId, intent.id)));
  return pending.map((before) => {
    const intent = intentById(before.id) ?? before;
    return {
      id: intent.id,
      status: intent.status,
      payload: JSON.parse(intent.payload),
      createdAt: intent.created_at,
      ...(intent.operation_id ? { operationId: intent.operation_id } : {}),
    };
  });
}
export const dashboard: Handler = async ({ actor }) => {
  if (actor.role === 'operator') return json({ incidents: allIncidents() });
  const [accounts, movements, contacts, pending] = await Promise.all([
    bank.accounts(actor.id),
    bank.movements(actor.id),
    bank.contacts(actor.id),
    pendingTransfers(actor.id),
  ]);
  const approvals = liveApprovalsOf(actor.id, new Date().toISOString()).map((a) => ({
    ...a,
    payload: JSON.parse(a.payload),
  }));
  return json({ accounts, movements, contacts, approvals, pendingTransfers: pending });
};
