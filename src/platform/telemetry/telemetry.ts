import { randomUUID } from 'node:crypto';
import { insertEvent } from './events.repo';
import type { ToolContext } from '../../types';
export function recordEvent(ctx: ToolContext, kind: string, data: Record<string, unknown>) {
  insertEvent({
    id: randomUUID(),
    runId: ctx.runId,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    kind,
    data: JSON.stringify(data),
    createdAt: new Date().toISOString(),
  });
}
