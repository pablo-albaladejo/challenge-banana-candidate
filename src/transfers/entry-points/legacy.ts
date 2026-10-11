// The frozen `src/banking/actions` surface: its callers still catch the legacy HTTP and bank errors.
import { toLegacyError } from '../../platform/http/errors';
import { transfers } from './dependencies';
import type { ActionResult, ToolContext } from '../../types';
export { transferSchema } from '../domain/transfer';
export async function transferMoney(ctx: ToolContext, args: unknown): Promise<ActionResult> {
  try {
    return await transfers().transferMoney({ ...ctx, args });
  } catch (e) {
    throw toLegacyError(e);
  }
}
