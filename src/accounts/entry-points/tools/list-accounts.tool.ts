import { z } from 'zod';
import { accounts } from '../dependencies';
import type { Tool } from '../../../assistant';
export const listAccountsTool: Tool = {
  name: 'list_accounts',
  description: "Get the current customer's accounts, balances, and available recipients.",
  input: z.object({}),
  // No arguments to read: the account holder is always the context user.
  execute: (_args, ctx) => accounts().listAccounts({ userId: ctx.userId }),
};
