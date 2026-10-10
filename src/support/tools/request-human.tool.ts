import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { insertIncident, openIncidentIn } from '../incidents.repo';
import type { Tool } from '../../assistant';
const input = z.object({ summary: z.string().min(1).max(2000) });
export const requestHumanTool: Tool = {
  name: 'request_human',
  description: 'Open a human support case for this conversation.',
  input,
  execute: async (args, ctx) => {
    if (!ctx.conversationId) throw new Error('A conversation is required to open a case.');
    const { summary } = input.parse(args);
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
    return { status: 'open', incidentId: id };
  },
};
