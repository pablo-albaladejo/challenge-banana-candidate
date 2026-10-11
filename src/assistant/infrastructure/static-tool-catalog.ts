import { strictSchema } from './strict-schema';
import type { FunctionTool } from 'openai/resources/responses/responses';
import type { Tool, ToolCatalog } from '../application/ports/tool-catalog';
/** A fixed list of tools; their strict definitions are derived once, in list order. */
export function staticToolCatalog(tools: Tool[]): ToolCatalog {
  const definitions: FunctionTool[] = tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: strictSchema(tool.input),
    strict: true,
  }));
  return { definitions, find: (name) => tools.find((t) => t.name === name) };
}
