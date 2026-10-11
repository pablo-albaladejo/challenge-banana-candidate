import type { Clock } from '../../../shared/ports/clock';
import type { ToolContext } from '../../../types';
import type { EventLog } from '../ports/event-log';
import type { ToolCatalog } from '../ports/tool-catalog';
type Deps = { catalog: ToolCatalog; events: EventLog; clock: Clock };
export type RunToolCommand = { name: string; args: unknown; ctx: ToolContext };
/**
 * Runs one tool by name with the server-built context. Never throws: a failure becomes
 * `{ status: 'failed', error }` with the error's message, and every run is recorded as events.
 */
export const makeRunTool =
  ({ catalog, events, clock }: Deps) =>
  async ({ name, args, ctx }: RunToolCommand): Promise<unknown> => {
    const started = clock.now().getTime();
    events.record(ctx, 'tool.started', { tool: name, status: 'started', arguments: args });
    let result: unknown;
    try {
      const tool = catalog.find(name);
      if (!tool) throw new Error('Unknown tool.');
      result = await tool.execute(args, ctx);
      events.record(ctx, 'tool.completed', {
        tool: name,
        status: 'completed',
        arguments: args,
        output: result,
        durationMs: clock.now().getTime() - started,
      });
      return result;
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Tool error';
      events.record(ctx, 'tool.failed', {
        tool: name,
        status: 'failed',
        arguments: args,
        error,
        durationMs: clock.now().getTime() - started,
      });
      return { status: 'failed', error };
    }
  };
export type RunTool = ReturnType<typeof makeRunTool>;
