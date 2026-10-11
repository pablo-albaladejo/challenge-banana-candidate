import type { IntentRow } from './intent';
/** How many unsettled transfers one dashboard load checks with the bank. */
export const PENDING_TRANSFERS_LIMIT = 10;
/** Failed transfers that reached the bank since this time may still be completed by a late commit. */
export const failedSince = (now: Date) =>
  new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
/** A pending transfer as the dashboard shows it. */
export const toPendingTransfer = (intent: IntentRow) => ({
  id: intent.id,
  status: intent.status,
  payload: JSON.parse(intent.payload),
  createdAt: intent.created_at,
  ...(intent.operation_id ? { operationId: intent.operation_id } : {}),
});
export type PendingTransfer = ReturnType<typeof toPendingTransfer>;
