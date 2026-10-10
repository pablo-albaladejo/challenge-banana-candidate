import type { z } from 'zod';
import type { FunctionTool } from 'openai/resources/responses/responses';
import { recordEvent } from '../../telemetry';
import type { ToolContext } from '../../types';
import { strictSchema } from './strict-schema';
import { listAccountsTool } from './list-accounts';
import { searchDocumentsTool } from './search-documents';
import { transferMoneyTool } from './transfer-money';
import { operationStatusTool } from './operation-status';
import { requestHumanTool } from './request-human';
/**
 * One agent tool. `input` only derives the definition the model sees; `execute` receives the raw
 * arguments and parses them itself, so each tool keeps its own validation order.
 */
export type Tool = {
  name: string;
  description: string;
  input: z.ZodObject;
  execute: (args: unknown, ctx: ToolContext) => Promise<unknown>;
};
const tools: Tool[] = [
  listAccountsTool,
  searchDocumentsTool,
  transferMoneyTool,
  operationStatusTool,
  requestHumanTool,
];
export const toolDefinitions: FunctionTool[] = tools.map((tool) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: strictSchema(tool.input),
  strict: true,
}));
export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<unknown> {
  const started = Date.now();
  recordEvent(ctx, 'tool.started', { tool: name, status: 'started', arguments: args });
  let result: unknown;
  try {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error('Unknown tool.');
    result = await tool.execute(args, ctx);
    recordEvent(ctx, 'tool.completed', {
      tool: name,
      status: 'completed',
      arguments: args,
      output: result,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Tool error';
    recordEvent(ctx, 'tool.failed', {
      tool: name,
      status: 'failed',
      arguments: args,
      error,
      durationMs: Date.now() - started,
    });
    return { status: 'failed', error };
  }
}
