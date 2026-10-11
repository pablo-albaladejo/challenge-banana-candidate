import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseFunctionToolCall } from 'openai/resources/responses/responses';
import { createResponse } from '../../platform/model/gateway';
import { config } from '../../platform/config';
import type { ModelPort } from '../application/ports/model-port';
/**
 * The model over the Responses API (`platform/model/gateway`). The request bodies are today's
 * literals, key order included; `chatModel` is read at call time. Provider errors pass through.
 */
export const openaiModel: ModelPort = {
  async agentTurn({ instructions, input, tools }) {
    const response = await createResponse({
      model: config.chatModel,
      instructions,
      input,
      tools,
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 2000,
      store: false,
      include: ['reasoning.encrypted_content'],
    });
    return {
      items: toResponseInputItems(response.output),
      calls: response.output.filter(
        (x): x is ResponseFunctionToolCall => x.type === 'function_call',
      ),
      text: response.output_text,
    };
  },
  async evidenceAnswer({ instructions, question }) {
    const response = await createResponse({
      model: config.chatModel,
      instructions,
      input: question,
      reasoning: { effort: 'low' },
      max_output_tokens: 1200,
      store: false,
    });
    return { answer: response.output_text, model: response.model, usage: response.usage };
  },
};
