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
