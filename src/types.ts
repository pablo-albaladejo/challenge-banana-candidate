export type Person = {
  id: string;
  name: string;
  role: 'customer' | 'operator';
  initials: string;
  color: string;
};
export type Account = {
  id: string;
  userId: string;
  label: string;
  iban: string;
  balanceCents: number;
};
export type TransferInput = {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  concept: string;
};
export type Operation = TransferInput & {
  id: string;
  userId: string;
  reference: string;
  createdAt: string;
  status: 'completed';
};
export type ToolContext = {
  userId: string;
  conversationId: string | null;
  runId: string;
  intentId: string;
  approvalId?: string;
  /**
   * Set only by the customer's "send anyway" in the UI (`POST /api/actions`), never by the model:
   * the pending intent the customer chose to send a matching transfer past.
   */
  overridePendingIntentId?: string;
};
/** A new proposal held back because a matching transfer is still being verified with the bank. */
export type RequiresReviewResult = {
  status: 'requires_review';
  pendingIntentId: string;
  intentId: string;
  error: string;
  [key: string]: unknown;
};
export type ActionResult = RequiresReviewResult | { status: string; [key: string]: unknown };
export type DocumentRecord = {
  id: string;
  title: string;
  file: string;
  version: number;
  validFrom: string;
  validTo: string | null;
  audience: 'public' | 'internal';
  family: string;
};
export type Chunk = {
  id: string;
  documentId: string;
  text: string;
  title: string | null;
  version: number | null;
  validFrom: string | null;
  validTo: string | null;
  audience: string;
  vector?: number[];
};
export type SearchResult = Omit<Chunk, 'vector'> & { score: number };
