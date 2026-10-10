import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import { createResponse } from '../model/gateway';
import { toolDefinitions, runTool } from './tools/registry';
import { recordEvent } from '../telemetry';
import { config } from '../config';
export const maxRounds = 7;
/** The run a loop answers for: who asks, in which conversation, under which run id. */
export type LoopRun = { userId: string; conversationId: string; runId: string };
/**
 * Model ↔ tool rounds until the model answers in text or `maxRounds` runs out. `input` is extended
 * in place with each round's output and tool results. Persists nothing but tool events.
 */
export async function runLoop(run: LoopRun, instructions: string, input: ResponseInputItem[]) {
  let answer = 'I could not finish this request. Try again or ask for human support.';
  let finished = false;
  for (let round = 0; round < maxRounds; round++) {
    const response = await createResponse({
      model: config.chatModel,
      instructions,
      input,
      tools: toolDefinitions,
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 2000,
      store: false,
      include: ['reasoning.encrypted_content'],
    });
    input.push(...toResponseInputItems(response.output));
    const calls = response.output.filter((x) => x.type === 'function_call');
    if (!calls.length) {
      answer = response.output_text || answer;
      finished = true;
      break;
    }
    for (const call of calls) {
      // Built field by field: an approval or an override of a pending transfer never comes from the model.
      const ctx = {
        userId: run.userId,
        conversationId: run.conversationId,
        runId: run.runId,
        intentId: `${run.runId}:${call.call_id}`,
      };
      let result: unknown;
      try {
        result = await runTool(call.name, JSON.parse(call.arguments), ctx);
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        // Never run a tool on guessed arguments: tell the model so it can retry the call.
        const error =
          'The tool arguments were not valid JSON. Retry the call with valid arguments.';
        recordEvent(ctx, 'tool.failed', { tool: call.name, status: 'failed', error });
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
}
