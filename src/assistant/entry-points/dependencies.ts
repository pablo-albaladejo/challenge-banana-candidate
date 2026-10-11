import { randomIds, systemClock } from '../../platform/runtime';
import { knowledge } from '../../knowledge';
import { conversations } from '../../conversations';
import { openaiModel } from '../infrastructure/openai-model.adapter';
import { staticToolCatalog } from '../infrastructure/static-tool-catalog';
import { sqliteRuns } from '../infrastructure/sqlite-runs.repo';
import { inMemoryConversationLocks } from '../infrastructure/in-memory-conversation-locks';
import { telemetryEventLog } from '../infrastructure/telemetry-event-log';
import { makeRunAgentLoop } from '../application/services/run-agent-loop';
import { makeRunTool } from '../application/use-cases/run-tool';
import { makeSendMessage } from '../application/use-cases/send-message';
import { makePreviewAnswer } from '../application/use-cases/preview-answer';
import { tools } from './tools/catalog';
import type { Clock } from '../../shared/ports/clock';
import type { Ids } from '../../shared/ports/ids';
import type { ModelPort } from '../application/ports/model-port';
import type { ToolCatalog } from '../application/ports/tool-catalog';
import type { KnowledgePort } from '../application/ports/knowledge-port';
import type { ConversationLog } from '../application/ports/conversation-log';
import type { RunRepository } from '../application/ports/run-repository';
import type { ConversationLocks } from '../application/ports/conversation-locks';
import type { EventLog } from '../application/ports/event-log';
export type AssistantDeps = {
  model: ModelPort;
  catalog: ToolCatalog;
  knowledge: KnowledgePort;
  conversations: ConversationLog;
  runs: RunRepository;
  locks: ConversationLocks;
  events: EventLog;
  clock: Clock;
  ids: Ids;
};
/** Only the clock and ids may be faked. The model, locks and repos are always the real ones. */
export type AssistantOverrides = Partial<Pick<AssistantDeps, 'clock' | 'ids'>>;
/** One catalog per process: the tool definitions are derived once and shared by every graph. */
const catalog = staticToolCatalog(tools);
/** The definitions the model sees, as a plain value (frozen `src/agent/tools` surface). */
export const toolDefinitions = catalog.definitions;
const conversationLog: ConversationLog = {
  requireOwned(conversationId, userId) {
    conversations().getOwnedConversation({ conversationId, userId });
  },
  append: (message) => conversations().appendMessage(message),
  history: (conversationId) => conversations().listMessages({ conversationId }),
};
const defaults = (): AssistantDeps => ({
  model: openaiModel,
  catalog,
  knowledge: {
    search: async (query) =>
      (await knowledge().searchDocuments({ query, role: 'customer' })).sources,
  },
  conversations: conversationLog,
  runs: sqliteRuns,
  locks: inMemoryConversationLocks(),
  events: telemetryEventLog,
  clock: systemClock,
  ids: randomIds,
});
export function wireAssistant(overrides: AssistantOverrides = {}) {
  const deps = { ...defaults(), ...overrides };
  const runTool = makeRunTool(deps);
  const runAgentLoop = makeRunAgentLoop({ ...deps, runTool });
  return {
    sendMessage: makeSendMessage({ ...deps, runAgentLoop }),
    runTool,
    previewAnswer: makePreviewAnswer(deps),
    /** Tests only: the service and the lock registry, wired to the same deps. */
    internals: { runAgentLoop, locks: deps.locks },
  };
}
/** What index.ts exposes: the use cases, never the internals. */
export type AssistantApp = Omit<ReturnType<typeof wireAssistant>, 'internals'>;
let graph: AssistantApp | undefined;
export const assistant = (): AssistantApp => (graph ??= wireAssistant());
