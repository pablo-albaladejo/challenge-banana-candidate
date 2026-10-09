import { randomUUID } from 'node:crypto';
import { bankRequest, BankError } from './client';
import { intentById, updateIntent } from '../persistence/intents';
import type { Operation, ToolContext, TransferInput } from '../types';
/** One bank reference per intent: retries replay the original operation instead of adding one. */
function intentReference(intentId: string) {
  const row = intentById(intentId);
  if (row?.bank_reference) return row.bank_reference;
  const reference = randomUUID();
  updateIntent(intentId, { bank_reference: reference });
  return reference;
}
export async function dispatchTransfer(ctx: ToolContext, input: TransferInput): Promise<Operation> {
  const reference = intentReference(ctx.intentId);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await bankRequest<Operation>(ctx.userId, '/v1/transfers', 'POST', {
        ...input,
        reference,
      });
    } catch (e) {
      if (!(e instanceof BankError) || e.status < 500 || attempt === 1) throw e;
    }
  }
  throw new BankError(504, 'The operation could not be completed.');
}
