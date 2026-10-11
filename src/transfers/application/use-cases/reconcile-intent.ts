import { IllegalTransitionError } from '../../domain/transitions';
import { reconcileDecision, shouldReconcile, staleProcessingMs } from '../../domain/reconciliation';
import type { Clock } from '../../../shared/ports/clock';
import type { DispatchRegistry } from '../ports/dispatch-registry';
import type { IntentRepository } from '../ports/intent-repository';
import type { TransfersBank } from '../ports/transfers-bank';
import type { TransfersSettings } from '../ports/settings';
import type { TransitionIntent } from '../services/transition-intent';
type Deps = {
  intents: IntentRepository;
  bank: TransfersBank;
  dispatching: DispatchRegistry;
  clock: Clock;
  settings: TransfersSettings;
  transition: TransitionIntent;
};
export type ReconcileIntentCommand = { userId: string; intentId: string };
/**
 * Replaces an unverified intent outcome with what the bank reports for its reference. A lost
 * response is `unknown`, an older transport `failed` may hide a completed operation, and a
 * `processing` intent older than `staleProcessingMs` was left behind by a dispatch that never
 * finished (a restart or a killed request), so all three are checked. A bank that cannot be
 * reached leaves the intent as it was: nothing is guessed.
 */
export function makeReconcileIntent({
  intents,
  bank,
  dispatching,
  clock,
  settings,
  transition,
}: Deps) {
  /**
   * The intent was read before the bank call; if another writer settled it meanwhile (a dispatch
   * that finished, or a parallel reconcile), the compare-and-set rejects the edge and the first
   * outcome stays: reconcile never overwrites a newer status.
   */
  function settle(...args: Parameters<TransitionIntent>) {
    try {
      transition(...args);
    } catch (e) {
      if (!(e instanceof IllegalTransitionError)) throw e;
    }
  }
  return async ({ userId, intentId }: ReconcileIntentCommand): Promise<void> => {
    const intent = intents.ownedBy(intentId, userId);
    // `bankTimeoutMs` is read at each check, because the settings object is mutable.
    const staleMs = () => staleProcessingMs(settings.bankTimeoutMs);
    // A dispatch in flight here owns the outcome, whatever the intent's status or age.
    if (!shouldReconcile(intent, dispatching.has(intentId), clock.now().getTime(), staleMs()))
      return;
    let lookup: Parameters<typeof reconcileDecision>[1];
    try {
      lookup = { operation: await bank.operation(userId, intent.bank_reference) };
    } catch (error) {
      lookup = { error };
    }
    const decision = reconcileDecision(intent, lookup, clock.now().getTime(), staleMs());
    if (decision) settle(intentId, decision.to, decision.fields);
  };
}
export type ReconcileIntent = ReturnType<typeof makeReconcileIntent>;
