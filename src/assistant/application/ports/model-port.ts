// `import type` from 'openai' is erased; the client itself lives in infrastructure/.
import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses';
/** The model as the assistant uses it. Provider errors reach the caller untouched. */
export type ModelPort = {
  /** One agent round: the output as input items, the tool calls in it, and its text. */
  agentTurn(req: {
    instructions: string;
    input: ResponseInputItem[];
    tools: FunctionTool[];
  }): Promise<{ items: ResponseInputItem[]; calls: ResponseFunctionToolCall[]; text: string }>;
  /** An answer to one question from the given instructions, without tools. */
  evidenceAnswer(req: {
    instructions: string;
    question: string;
  }): Promise<{ answer: string; model: string; usage: ResponseUsage | undefined }>;
};
