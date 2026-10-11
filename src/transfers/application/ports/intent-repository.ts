import type { IntentFields, IntentRow, NewIntent } from '../../domain/intent';
import type { IntentStatus } from '../../domain/transitions';
export type IntentRepository = {
  /** Stores the intent unless one with the same id exists; returns how many rows it wrote. */
  insertIfAbsent(i: NewIntent): number;
  byId(id: string): IntentRow | undefined;
  /** The intent, only when `userId` owns it. */
  ownedBy(id: string, userId: string): IntentRow | undefined;
  /** A conversation's intents, oldest first. */
  inConversation(conversationId: string): IntentRow[];
  /** Every intent of a customer, newest first. */
  ofCustomer(userId: string): IntentRow[];
  /** Intents of a conversation whose outcome the bank has not confirmed (`unknown`, `failed`). */
  unsettledIdsIn(conversationId: string): { id: string }[];
  /** Unsettled intents first, then `failed` ones that reached the bank since `failedSince`. */
  pendingOf(userId: string, limit: number, failedSince: string): IntentRow[];
  /** The customer's other unsettled intents for exactly the same payload, newest first. */
  pendingTwinsOf(userId: string, payload: string, excludeId: string): IntentRow[];
  /** Writes only the given fields; returns how many rows changed. */
  update(id: string, fields: IntentFields): number;
  /** Writes the status and fields only while the stored status is one of `from`. */
  compareAndSet(
    id: string,
    to: IntentStatus,
    from: readonly IntentStatus[],
    fields?: Omit<IntentFields, 'status'>,
  ): number;
};
