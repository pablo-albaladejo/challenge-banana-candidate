/** Model rounds per run before it is recorded `incomplete`. */
export const MAX_ROUNDS = 7;
export const maxRounds = MAX_ROUNDS;
/** The answer when the model never replies in text within the rounds. */
export const FALLBACK_ANSWER =
  'I could not finish this request. Try again or ask for human support.';
/** What the model is told when a tool call's arguments are not JSON: it may retry the call. */
export const INVALID_TOOL_ARGUMENTS =
  'The tool arguments were not valid JSON. Retry the call with valid arguments.';
/** One intent per model tool call. */
export const toolIntentId = (runId: string, callId: string) => `${runId}:${callId}`;
/** The conversation turns the model sees: the last 24 messages, role and content only. */
export const historyWindow = (messages: { role: string; content: string }[]) =>
  messages.slice(-24).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
/** Running out of rounds is not a completed answer: the run records it. */
export const runOutcome = (
  finished: boolean,
): { status: 'completed' } | { status: 'incomplete'; error: string } =>
  finished
    ? { status: 'completed' }
    : {
        status: 'incomplete',
        error: `Round limit reached after ${MAX_ROUNDS} model rounds without a final answer.`,
      };
/**
 * A failed run's error text: a provider's own `providerMessage` (claude-cli names itself and the
 * likely cause), else any error with a `status` is a provider failure.
 */
export function failureText(e: unknown) {
  const api = e as { status?: number; providerMessage?: unknown } | undefined;
  if (typeof api?.providerMessage === 'string') return api.providerMessage;
  return api?.status
    ? `The AI provider returned ${api.status}. Check permissions and quota.`
    : e instanceof Error
      ? e.message
      : 'The response could not be completed.';
}
/** The assistant message stored for a failed run. */
export const failureReply = (error: string) => `I could not complete the request: ${error}`;
