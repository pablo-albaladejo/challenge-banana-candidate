import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FunctionTool } from 'openai/resources/responses/responses';
import * as bank from '../banking/bank';
import { transferMoney } from '../banking/actions';
import { searchDocuments } from '../retrieval/search';
import { insertIncident, openIncidentIn } from '../persistence/incidents';
import { recordEvent } from '../telemetry';
import type { ToolContext } from '../types';
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: 'string' };
export const toolDefinitions: FunctionTool[] = [
  {
    type: 'function',
    name: 'list_accounts',
    description: "Get the current customer's accounts, balances, and available recipients.",
    parameters: object({}),
    strict: true,
  },
  {
    type: 'function',
    name: 'search_documents',
    description: "Search the bank's documentation for policies and procedures.",
    parameters: object({ query: string }),
    strict: true,
  },
  {
    type: 'function',
    name: 'transfer_money',
    description:
      'Propose a transfer for the customer to review. Amounts are integer cents. It moves no money: ' +
      'the customer must confirm the proposal in the app, so never say the transfer is done. ' +
      'If it returns requires_review, a matching transfer is still being verified with the bank: ' +
      'tell the customer, do not propose it again, and say they can check it on the dashboard or ' +
      'send it anyway from the Transfers screen.',
    parameters: object({
      fromAccountId: string,
      toAccountId: string,
      amountCents: { type: 'integer' },
      concept: string,
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'operation_status',
    description: 'Look up an operation by its bank reference.',
    parameters: object({ reference: string }),
    strict: true,
  },
  {
    type: 'function',
    name: 'request_human',
    description: 'Open a human support case for this conversation.',
    parameters: object({ summary: string }),
    strict: true,
  },
];
export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<unknown> {
  const started = Date.now();
  recordEvent(ctx, 'tool.started', { tool: name, status: 'started', arguments: args });
  let result: unknown;
  try {
    switch (name) {
      case 'list_accounts':
        result = {
          accounts: await bank.accounts(ctx.userId),
          contacts: await bank.contacts(ctx.userId),
        };
        break;
      case 'search_documents':
        result = {
          sources: await searchDocuments(
            z.object({ query: z.string().max(2000) }).parse(args).query,
          ),
        };
        break;
      case 'transfer_money':
        result = await transferMoney(ctx, args);
        break;
      case 'operation_status':
        result = await bank.operation(
          ctx.userId,
          z.object({ reference: z.string() }).parse(args).reference,
        );
        break;
      case 'request_human': {
        if (!ctx.conversationId) throw new Error('A conversation is required to open a case.');
        const { summary } = z.object({ summary: z.string().min(1).max(2000) }).parse(args);
        const existing = openIncidentIn(ctx.conversationId);
        const id = existing?.id || randomUUID();
        if (!existing)
          insertIncident({
            id,
            userId: ctx.userId,
            conversationId: ctx.conversationId,
            summary,
            status: 'open',
            createdAt: new Date().toISOString(),
          });
        result = { status: 'open', incidentId: id };
        break;
      }
      default:
        throw new Error('Unknown tool.');
    }
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
