import type { IntentRepository } from '../ports/intent-repository';
import type { ReconcileIntent } from './reconcile-intent';
type Deps = { intents: IntentRepository; reconcileIntent: ReconcileIntent };
/**
 * A conversation's intents, oldest first, each with its payload parsed, after every unsettled one
 * (`unknown`, `failed`) was checked with the bank, one at a time.
 */
export const makeGetConversationTransfers =
  ({ intents, reconcileIntent }: Deps) =>
  async ({ userId, conversationId }: { userId: string; conversationId: string }) => {
    for (const { id: intentId } of intents.unsettledIdsIn(conversationId))
      await reconcileIntent({ userId, intentId });
    return intents.inConversation(conversationId).map((i) => ({
      ...i,
      payload: JSON.parse(i.payload),
    }));
  };
