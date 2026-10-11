import { ConflictError, UnavailableError } from '../../../shared/domain/errors';
import { agentInstructions } from '../../domain/prompt';
import { failureReply, failureText, historyWindow, runOutcome } from '../../domain/run-policy';
import type { Clock } from '../../../shared/ports/clock';
import type { Ids } from '../../../shared/ports/ids';
import type { ConversationLocks } from '../ports/conversation-locks';
import type { ConversationLog } from '../ports/conversation-log';
import type { KnowledgePort } from '../ports/knowledge-port';
import type { RunRepository } from '../ports/run-repository';
import type { RunAgentLoop } from '../services/run-agent-loop';
type Deps = {
  conversations: ConversationLog;
  locks: ConversationLocks;
  runs: RunRepository;
  knowledge: KnowledgePort;
  clock: Clock;
  ids: Ids;
  runAgentLoop: RunAgentLoop;
};
export type SendMessageCommand = { userId: string; conversationId: string; content: string };
/**
 * Answers a customer message in their conversation, one answer at a time per conversation: stores
 * the message and a run, grounds the agent on the retrieved documentation and the recent history,
 * and stores the answer. A failure is stored as the run's error and an assistant message, then
 * thrown as `UnavailableError`.
 */
export function makeSendMessage(deps: Deps) {
  const { conversations, locks, runs, knowledge, clock, ids, runAgentLoop } = deps;
  return async ({ userId, conversationId, content }: SendMessageCommand) => {
    conversations.requireOwned(conversationId, userId);
    if (!locks.tryAcquire(conversationId))
      throw new ConflictError('Wait for the previous response to finish.');
    const runId = ids.uuid(),
      now = clock.now().toISOString();
    runs.insert({
      id: runId,
      userId,
      conversationId,
      startedAt: now,
      status: 'running',
      error: null,
    });
    conversations.append({
      id: ids.uuid(),
      conversationId,
      role: 'user',
      content,
      createdAt: now,
      runId,
    });
    try {
      const sources = await knowledge.search(content);
      const input = historyWindow(conversations.history(conversationId));
      const { answer, finished } = await runAgentLoop(
        { userId, conversationId, runId },
        agentInstructions(sources),
        input,
      );
      conversations.append({
        id: ids.uuid(),
        conversationId,
        role: 'assistant',
        content: answer,
        createdAt: clock.now().toISOString(),
        runId,
      });
      // Running out of rounds is not a completed answer: record it so the run reflects the facts.
      const outcome = runOutcome(finished);
      if (outcome.status === 'completed') runs.setStatus(runId, 'completed');
      else runs.setStatus(runId, outcome.status, outcome.error);
      return { runId, answer };
    } catch (e) {
      const error = failureText(e);
      runs.setStatus(runId, 'failed', error);
      conversations.append({
        id: ids.uuid(),
        conversationId,
        role: 'assistant',
        content: failureReply(error),
        createdAt: clock.now().toISOString(),
        runId,
      });
      throw new UnavailableError(error);
    } finally {
      locks.release(conversationId);
    }
  };
}
export type SendMessage = ReturnType<typeof makeSendMessage>;
