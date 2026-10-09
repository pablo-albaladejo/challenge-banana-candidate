import { appDb } from '../db';
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
};
export type IntentFields = Partial<
  Pick<IntentRow, 'status' | 'bank_reference' | 'operation_id' | 'error'>
>;
const columns =
  'id,user_id,conversation_id,run_id,payload,status,bank_reference,operation_id,error,created_at';
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
];
export function insertIntent(i: NewIntent) {
  appDb()
    .prepare(`INSERT INTO intents(${columns}) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(...values(i));
}
/** Stores the intent unless one with the same id exists; returns how many rows it wrote. */
export function insertIntentIfAbsent(i: NewIntent) {
  return appDb()
    .prepare(`INSERT OR IGNORE INTO intents(${columns}) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(...values(i)).changes;
}
export function intentById(id: string) {
  return appDb().prepare('SELECT * FROM intents WHERE id=?').get(id) as IntentRow | undefined;
}
/** The intent, only when `userId` owns it. */
export function intentOf(id: string, userId: string) {
  return appDb().prepare('SELECT * FROM intents WHERE id=? AND user_id=?').get(id, userId) as
    IntentRow | undefined;
}
/** A conversation's intents, oldest first. */
export function intentsIn(conversationId: string) {
  return appDb()
    .prepare('SELECT * FROM intents WHERE conversation_id=? ORDER BY created_at')
    .all(conversationId) as IntentRow[];
}
/** Intents of a conversation whose outcome the bank has not confirmed (`unknown`, `failed`). */
export function unsettledIntentIds(conversationId: string) {
  return appDb()
    .prepare("SELECT id FROM intents WHERE conversation_id=? AND status IN ('unknown','failed')")
    .all(conversationId) as { id: string }[];
}
/** Writes only the given fields of the intent; returns how many rows changed. */
export function updateIntent(id: string, fields: IntentFields) {
  const keys = (['status', 'bank_reference', 'operation_id', 'error'] as const).filter(
    (k) => k in fields,
  );
  if (!keys.length) return 0;
  return appDb()
    .prepare(`UPDATE intents SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`)
    .run(...keys.map((k) => fields[k] ?? null), id).changes;
}
