import type { z } from 'zod';
import type { FunctionTool } from 'openai/resources/responses/responses';
import type { ToolContext } from '../../../types';
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
/** The tools the model may call: their strict definitions, and lookup by name. */
export type ToolCatalog = { definitions: FunctionTool[]; find(name: string): Tool | undefined };
