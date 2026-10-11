import { IllegalTransitionError, type IntentStatus } from '../../domain/transitions';
import { storedOutcome } from '../../domain/outcome';
import type { IntentFields } from '../../domain/intent';
import type { ActionResult, TransferInput } from '../../../types';
import type { IntentRepository } from '../ports/intent-repository';
import type { TransitionIntent } from './transition-intent';
/**
 * Writes a status edge. If another writer moved the intent first, the edge is illegal and nothing
 * is written: the caller answers with the stored outcome instead, so a booked operation is never
 * reported as an error.
 */
export const makeRecordOutcome =
  ({ intents, transition }: { intents: IntentRepository; transition: TransitionIntent }) =>
  (
    intentId: string,
    input: TransferInput,
    to: IntentStatus,
    fields: Omit<IntentFields, 'status'> = {},
  ): ActionResult | null => {
    try {
      transition(intentId, to, fields);
      return null;
    } catch (e) {
      if (!(e instanceof IllegalTransitionError)) throw e;
      return storedOutcome(intents.byId(intentId)!, input);
    }
  };
