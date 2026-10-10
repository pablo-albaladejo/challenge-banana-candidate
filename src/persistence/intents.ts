import { statement } from './statement';
export type IntentRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  run_id: string | null;
  payload: string;
  status: string;
  bank_reference: string | null;
  operation_id: string | null;
  error: string | null;
  created_at: string;
  /** When the intent entered `processing`; null before that and on rows older than migration 2. */
  dispatched_at: string | null;
};
/** An intent to store, in any status. `payload` is the JSON of the transfer input. */
export type NewIntent = {
  id: string;
  userId: string;
  conversationId: string | null;
  runId: string | null;
  payload: string;
  status: string;
  bankReference: string | null;
  operationId: string | null;
  error: string | null;
  createdAt: string;
  dispatchedAt?: string | null;
};
export type IntentFields = Partial<
  Pick<IntentRow, 'status' | 'bank_reference' | 'operation_id' | 'error' | 'dispatched_at'>
>;
const columns =
  'id,user_id,conversation_id,run_id,payload,status,bank_reference,operation_id,error,created_at,dispatched_at';
const values = (i: NewIntent) => [
  i.id,
  i.userId,
  i.conversationId,
  i.runId,
  i.payload,
  i.status,
  i.bankReference,
  i.operationId,
  i.error,
  i.createdAt,
  i.dispatchedAt ?? null,
];
export function insertIntent(i: NewIntent) {
  statement(`INSERT INTO intents(${columns}) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(...values(i));
}
/** Stores the intent unless one with the same id exists; returns how many rows it wrote. */
export function insertIntentIfAbsent(i: NewIntent) {
  return statement(`INSERT OR IGNORE INTO intents(${columns}) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    ...values(i),
  ).changes;
}
export function intentById(id: string) {
  return statement('SELECT * FROM intents WHERE id=?').get(id) as IntentRow | undefined;
}
/** The intent, only when `userId` owns it. */
export function intentOf(id: string, userId: string) {
  return statement('SELECT * FROM intents WHERE id=? AND user_id=?').get(id, userId) as
    IntentRow | undefined;
}
/** A conversation's intents, oldest first. */
export function intentsIn(conversationId: string) {
  return statement('SELECT * FROM intents WHERE conversation_id=? ORDER BY created_at').all(
    conversationId,
  ) as IntentRow[];
}
/** Intents of a conversation whose outcome the bank has not confirmed (`unknown`, `failed`). */
export function unsettledIntentIds(conversationId: string) {
  return statement(
    "SELECT id FROM intents WHERE conversation_id=? AND status IN ('unknown','failed')",
  ).all(conversationId) as { id: string }[];
}
/**
 * A customer's intents worth checking with the bank: first those it has not settled (`unknown`,
 * `processing`), then the `failed` ones that reached it (a `bank_reference`) since `failedSince`
 * (dispatch time, or creation on older rows), which a late commit may still complete; newest first
 * within each group, so the limit never drops an unsettled intent for a failed one.
 */
export function pendingIntentsOf(
  userId: string,
  limit: number,
  failedSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
) {
  return statement(
    "SELECT * FROM intents WHERE user_id=? AND (status IN ('unknown','processing') OR (status='failed' AND bank_reference IS NOT NULL AND COALESCE(dispatched_at,created_at)>?)) ORDER BY status='failed', created_at DESC, rowid DESC LIMIT ?",
  ).all(userId, failedSince, limit) as IntentRow[];
}
/**
 * The customer's other unsettled intents (`unknown`, `processing`) for exactly the same stored
 * payload JSON, newest first; `excludeId` is the intent asking.
 */
export function pendingTwinsOf(userId: string, payload: string, excludeId: string) {
  return statement(
    "SELECT * FROM intents WHERE user_id=? AND payload=? AND id<>? AND status IN ('unknown','processing') ORDER BY created_at DESC, rowid DESC",
  ).all(userId, payload, excludeId) as IntentRow[];
}
/** Writes only the given fields of the intent; returns how many rows changed. */
export function updateIntent(id: string, fields: IntentFields) {
  const keys = (
    ['status', 'bank_reference', 'operation_id', 'error', 'dispatched_at'] as const
  ).filter((k) => k in fields);
  if (!keys.length) return 0;
  return statement(`UPDATE intents SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(
    ...keys.map((k) => fields[k] ?? null),
    id,
  ).changes;
}
/**
 * Compare-and-set: writes the status and the given fields only while the stored status is one of
 * `from`, in one statement, so a concurrent writer cannot slip in between a read and the write.
 * Returns how many rows changed (0 for an unknown id or a status outside `from`).
 */
export function transitionIntent(
  id: string,
  to: string,
  from: readonly string[],
  fields: Omit<IntentFields, 'status'> = {},
) {
  if (!from.length) return 0;
  const keys = (['bank_reference', 'operation_id', 'error', 'dispatched_at'] as const).filter(
    (k) => k in fields,
  );
  const sets = ['status=?', ...keys.map((k) => `${k}=?`)].join(',');
  return statement(
    `UPDATE intents SET ${sets} WHERE id=? AND status IN (${from.map(() => '?').join(',')})`,
  ).run(to, ...keys.map((k) => fields[k] ?? null), id, ...from).changes;
}
