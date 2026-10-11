import { randomIds, systemClock } from '../../platform/runtime';
import { conversations } from '../../conversations';
import { transfers } from '../../transfers';
import { person } from '../../identity';
import { sqliteIncidents } from '../infrastructure/sqlite-incidents.repo';
import { telemetryEventReader } from '../infrastructure/telemetry-event-reader';
import { httpOperatorBank } from '../infrastructure/http-operator-bank.adapter';
import { makeListIncidents } from '../application/use-cases/list-incidents';
import { makeGetOperatorWorkspace } from '../application/use-cases/get-operator-workspace';
import { makeGetCaseDetail } from '../application/use-cases/get-case-detail';
import { makeRequestHuman } from '../application/use-cases/request-human';
import type { Clock } from '../../shared/ports/clock';
import type { Ids } from '../../shared/ports/ids';
import type { IncidentRepository } from '../application/ports/incident-repository';
import type { People } from '../application/ports/people';
import type { ConversationHistory } from '../application/ports/conversation-history';
import type { EventReader } from '../application/ports/event-reader';
import type { ConversationTransfers } from '../application/ports/conversation-transfers';
import type { OperatorBank } from '../application/ports/operator-bank';
export type SupportDeps = {
  incidents: IncidentRepository;
  people: People;
  history: ConversationHistory;
  events: EventReader;
  transfers: ConversationTransfers;
  bank: OperatorBank;
  clock: Clock;
  ids: Ids;
};
/**
 * Only the clock and ids may be faked (`RequestHuman` reads both). The repo, the bank and the other
 * verticals are always the real ones. No `internals`: there is no service to reach from a test.
 */
export type SupportOverrides = Partial<Pick<SupportDeps, 'clock' | 'ids'>>;
// The wired ports call the other verticals' accessors lazily, inside the arrow, never at wiring.
const defaults = (): SupportDeps => ({
  incidents: sqliteIncidents,
  people: { find: (id) => person(id) },
  history: { messagesIn: (conversationId) => conversations().listMessages({ conversationId }) },
  events: telemetryEventReader,
  transfers: {
    reconcileAndList: (userId, conversationId) =>
      transfers().getConversationTransfers({ userId, conversationId }),
  },
  bank: httpOperatorBank,
  clock: systemClock,
  ids: randomIds,
});
export function wireSupport(overrides: SupportOverrides = {}) {
  const deps = { ...defaults(), ...overrides };
  return {
    listIncidents: makeListIncidents(deps),
    getOperatorWorkspace: makeGetOperatorWorkspace(deps),
    getCaseDetail: makeGetCaseDetail(deps),
    requestHuman: makeRequestHuman(deps),
  };
}
/** What index.ts exposes: the use cases. */
export type SupportApp = ReturnType<typeof wireSupport>;
let graph: SupportApp | undefined;
export const support = (): SupportApp => (graph ??= wireSupport());
