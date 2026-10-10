import { z } from 'zod';
import * as bank from '../../banking/bank';
import type { Tool } from './registry';
const input = z.object({ reference: z.string() });
export const operationStatusTool: Tool = {
  name: 'operation_status',
  description: 'Look up an operation by its bank reference.',
  input,
  execute: (args, ctx) => bank.operation(ctx.userId, input.parse(args).reference),
};
