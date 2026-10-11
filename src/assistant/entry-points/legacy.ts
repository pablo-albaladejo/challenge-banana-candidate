// The frozen `src/agent/{run,tools}` surface: callers of `sendMessage` still catch `HttpError`, and
// `runTool` / `toolDefinitions` keep their positional signature and plain value.
import { toLegacyError } from '../../platform/http/errors';
import { assistant } from './dependencies';
import type { SearchResult, ToolContext } from '../../types';
export { toolDefinitions } from './dependencies';
export async function sendMessage(userId: string, conversationId: string, content: string) {
  try {
    return await assistant().sendMessage({ userId, conversationId, content });
  } catch (e) {
    throw toLegacyError(e);
  }
}
export const answerWithEvidence = (question: string, sources: SearchResult[]) =>
  assistant().previewAnswer({ question, sources });
export const runTool = (name: string, args: unknown, ctx: ToolContext): Promise<unknown> =>
  assistant().runTool({ name, args, ctx });
