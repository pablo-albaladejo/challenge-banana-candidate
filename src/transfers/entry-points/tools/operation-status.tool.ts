import { z } from 'zod';
import { transfers } from '../dependencies';
import type { Tool } from '../../../assistant';
const input = z.object({ reference: z.string() });
export const operationStatusTool: Tool = {
  name: 'operation_status',
  description: 'Look up an operation by its bank reference.',
  input,
  execute: (args, ctx) =>
    transfers().getOperationStatus({ userId: ctx.userId, reference: input.parse(args).reference }),
};
