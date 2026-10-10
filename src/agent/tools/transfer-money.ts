import { transferMoney, transferSchema } from '../../banking/actions';
import type { Tool } from './registry';
export const transferMoneyTool: Tool = {
  name: 'transfer_money',
  description:
    'Propose a transfer for the customer to review. Amounts are integer cents. It moves no money: ' +
    'the customer must confirm the proposal in the app, so never say the transfer is done. ' +
    'If it returns requires_review, a matching transfer is still being verified with the bank: ' +
    'tell the customer, do not propose it again, and say they can check it on the dashboard or ' +
    'send it anyway from the Transfers screen.',
  input: transferSchema,
  // `banking/actions.ts` validates the raw arguments itself (strict: no smuggled fields).
  execute: (args, ctx) => transferMoney(ctx, args),
};
