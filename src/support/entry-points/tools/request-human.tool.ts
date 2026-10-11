import { z } from 'zod';
import { support } from '../dependencies';
import type { Tool } from '../../../assistant';
const input = z.object({ summary: z.string().min(1).max(2000) });
export const requestHumanTool: Tool = {
  name: 'request_human',
  description: 'Open a human support case for this conversation.',
  input,
  // The conversation is checked before the summary is parsed, in that order.
  execute: async (args, ctx) => {
    if (!ctx.conversationId) throw new Error('A conversation is required to open a case.');
    const { summary } = input.parse(args);
    return support().requestHuman({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      summary,
    });
  },
};
