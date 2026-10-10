import { z } from 'zod';
import * as bank from '../../platform/bank/bank';
import type { Tool } from '../../assistant';
export const listAccountsTool: Tool = {
  name: 'list_accounts',
  description: "Get the current customer's accounts, balances, and available recipients.",
  input: z.object({}),
  // No arguments to read: the account holder is always the context user.
  execute: async (_args, ctx) => ({
    accounts: await bank.accounts(ctx.userId),
    contacts: await bank.contacts(ctx.userId),
  }),
};
