import type { ToolContext } from '../../../types';
export type EventLog = {
  record(ctx: ToolContext, kind: string, data: Record<string, unknown>): void;
};
