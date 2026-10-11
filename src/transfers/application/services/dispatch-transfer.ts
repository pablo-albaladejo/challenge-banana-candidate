import { BankFailure } from '../../../shared/domain/bank-failure';
import { DISPATCH_ATTEMPTS, shouldRetryDispatch } from '../../domain/outcome';
import type { Ids } from '../../../shared/ports/ids';
import type { Operation, ToolContext, TransferInput } from '../../../types';
import type { DispatchRegistry } from '../ports/dispatch-registry';
import type { IntentRepository } from '../ports/intent-repository';
import type { TransfersBank } from '../ports/transfers-bank';
type Deps = {
  intents: IntentRepository;
  bank: TransfersBank;
  dispatching: DispatchRegistry;
  ids: Ids;
};
/**
 * Sends the transfer to the bank under the intent's one reference, marked in flight meanwhile so
 * reconcile leaves it alone. Only an unreachable bank is retried, with the same reference.
 */
export function makeDispatchTransfer({ intents, bank, dispatching, ids }: Deps) {
  /** One bank reference per intent: retries replay the original operation instead of adding one. */
  function intentReference(intentId: string) {
    const row = intents.byId(intentId);
    if (row?.bank_reference) return row.bank_reference;
    const reference = ids.uuid();
    intents.update(intentId, { bank_reference: reference });
    return reference;
  }
  return async (ctx: ToolContext, input: TransferInput): Promise<Operation> => {
    const reference = intentReference(ctx.intentId);
    dispatching.add(ctx.intentId);
    try {
      for (let attempt = 0; attempt < DISPATCH_ATTEMPTS; attempt++) {
        try {
          return await bank.transfer(ctx.userId, input, reference);
        } catch (e) {
          if (!shouldRetryDispatch(e, attempt)) throw e;
        }
      }
      throw new BankFailure('unreachable', 504, 'The operation could not be completed.');
    } finally {
      dispatching.delete(ctx.intentId);
    }
  };
}
export type DispatchTransfer = ReturnType<typeof makeDispatchTransfer>;
