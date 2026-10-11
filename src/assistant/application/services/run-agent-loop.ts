import type { ResponseInputItem } from 'openai/resources/responses/responses';
import {
  FALLBACK_ANSWER,
  INVALID_TOOL_ARGUMENTS,
  MAX_ROUNDS,
  toolIntentId,
} from '../../domain/run-policy';
import type { EventLog } from '../ports/event-log';
import type { ModelPort } from '../ports/model-port';
import type { ToolCatalog } from '../ports/tool-catalog';
import type { RunTool } from '../use-cases/run-tool';
type Deps = { model: ModelPort; catalog: ToolCatalog; runTool: RunTool; events: EventLog };
/** The run a loop answers for: who asks, in which conversation, under which run id. */
export type LoopRun = { userId: string; conversationId: string; runId: string };
/**
 * Model ↔ tool rounds until the model answers in text or `MAX_ROUNDS` runs out. `input` is
 * extended in place with each round's output and tool results. Persists nothing but tool events.
 */
export const makeRunAgentLoop =
  ({ model, catalog, runTool, events }: Deps) =>
  async (run: LoopRun, instructions: string, input: ResponseInputItem[]) => {
    let answer = FALLBACK_ANSWER;
    let finished = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const turn = await model.agentTurn({ instructions, input, tools: catalog.definitions });
      input.push(...turn.items);
      if (!turn.calls.length) {
        answer = turn.text || answer;
        finished = true;
        break;
      }
      for (const call of turn.calls) {
        // Built field by field: an approval or an override of a pending transfer never comes from
        // the model.
        const ctx = {
          userId: run.userId,
          conversationId: run.conversationId,
          runId: run.runId,
          intentId: toolIntentId(run.runId, call.call_id),
        };
        let result: unknown;
        try {
          result = await runTool({ name: call.name, args: JSON.parse(call.arguments), ctx });
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
          // Never run a tool on guessed arguments: tell the model so it can retry the call.
          const error = INVALID_TOOL_ARGUMENTS;
          events.record(ctx, 'tool.failed', { tool: call.name, status: 'failed', error });
          result = { status: 'failed', error };
        }
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
    }
    return { answer, finished };
  };
export type RunAgentLoop = ReturnType<typeof makeRunAgentLoop>;
