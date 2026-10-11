import {
  IllegalTransitionError,
  predecessorsOf,
  type IntentStatus,
} from '../../domain/transitions';
import type { IntentFields } from '../../domain/intent';
import type { IntentRepository } from '../ports/intent-repository';
/**
 * Moves the intent to `to` and writes the given fields in one compare-and-set update, only from a
 * status whose `TRANSITIONS` list `to`. An unknown id writes nothing and returns
 * `{ changed: false }`; an edge outside the table writes nothing and throws
 * `IllegalTransitionError`. Normal flows never hit it: it means the intent changed under the
 * caller (a concurrent writer) or a bug, and the caller must not act as if the write happened.
 */
export const makeTransitionIntent =
  ({ intents }: { intents: IntentRepository }) =>
  (id: string, to: IntentStatus, fields: Omit<IntentFields, 'status'> = {}) => {
    if (intents.compareAndSet(id, to, predecessorsOf(to), fields) > 0)
      return { changed: true, legal: true };
    const current = intents.byId(id)?.status as IntentStatus | undefined;
    if (!current) return { changed: false, legal: false };
    throw new IllegalTransitionError(id, current, to);
  };
export type TransitionIntent = ReturnType<typeof makeTransitionIntent>;
