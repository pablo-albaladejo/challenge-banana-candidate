import { listAccountsTool } from '../../../accounts';
import { searchDocumentsTool } from '../../../knowledge';
import { transferMoneyTool, operationStatusTool } from '../../../transfers';
import { requestHumanTool } from '../../../support';
import type { Tool } from '../../application/ports/tool-catalog';
/** The tools the agent may call, in the order the model sees them. */
export const tools: Tool[] = [
  listAccountsTool,
  searchDocumentsTool,
  transferMoneyTool,
  operationStatusTool,
  requestHumanTool,
];
