import { config } from '../../platform/config';
import { randomIds, systemClock } from '../../platform/runtime';
import { identity } from '../../identity';
import { sqliteIntents } from '../infrastructure/sqlite-intents.repo';
import { sqliteApprovals } from '../infrastructure/sqlite-approvals.repo';
import { httpTransfersBank } from '../infrastructure/http-transfers-bank.adapter';
import { inMemoryDispatchRegistry } from '../infrastructure/in-memory-dispatch-registry';
import { sqliteUnitOfWork } from '../infrastructure/sqlite-unit-of-work';
import { telemetryEventLog } from '../infrastructure/telemetry-event-log';
import { makeTransitionIntent } from '../application/services/transition-intent';
import { makeAuthorizeTransfer } from '../application/services/authorize-transfer';
import { makeDispatchTransfer } from '../application/services/dispatch-transfer';
import { makeReconcileIntent } from '../application/use-cases/reconcile-intent';
import { makeTransferMoney } from '../application/use-cases/transfer-money';
import { makeFindProposal } from '../application/use-cases/find-proposal';
import { makeConfirmProposal } from '../application/use-cases/confirm-proposal';
import { makeGetOperationStatus } from '../application/use-cases/get-operation-status';
import { makeListPendingTransfers } from '../application/use-cases/list-pending-transfers';
import { makeListLiveProposals } from '../application/use-cases/list-live-proposals';
import { makeGetConversationTransfers } from '../application/use-cases/get-conversation-transfers';
import type { Clock } from '../../shared/ports/clock';
import type { Ids } from '../../shared/ports/ids';
import type { UnitOfWork } from '../../shared/ports/unit-of-work';
import type { IntentRepository } from '../application/ports/intent-repository';
import type { ApprovalRepository } from '../application/ports/approval-repository';
import type { TransfersBank } from '../application/ports/transfers-bank';
import type { DispatchRegistry } from '../application/ports/dispatch-registry';
import type { CustomerDirectory } from '../application/ports/customer-directory';
import type { EventLog } from '../application/ports/event-log';
import type { TransfersSettings } from '../application/ports/settings';
export type TransfersDeps = {
  intents: IntentRepository;
  approvals: ApprovalRepository;
  bank: TransfersBank;
  dispatching: DispatchRegistry;
  customers: CustomerDirectory;
  events: EventLog;
  unitOfWork: UnitOfWork;
  clock: Clock;
  ids: Ids;
  settings: TransfersSettings;
};
/** Only the clock and ids may be faked. Registries, repos and the bank are always the real ones. */
export type TransfersOverrides = Partial<Pick<TransfersDeps, 'clock' | 'ids'>>;
const defaults = (): TransfersDeps => ({
  intents: sqliteIntents,
  approvals: sqliteApprovals,
  bank: httpTransfersBank,
  dispatching: inMemoryDispatchRegistry(),
  customers: { roleOf: (id) => identity().findPerson({ id })?.role },
  events: telemetryEventLog,
  unitOfWork: sqliteUnitOfWork,
  clock: systemClock,
  ids: randomIds,
  settings: config,
});
export function wireTransfers(overrides: TransfersOverrides = {}) {
  const deps = { ...defaults(), ...overrides };
  const transition = makeTransitionIntent(deps);
  const reconcileIntent = makeReconcileIntent({ ...deps, transition });
  const authorizeTransfer = makeAuthorizeTransfer({ ...deps, transition, reconcileIntent });
  const dispatchTransfer = makeDispatchTransfer(deps);
  const transferMoney = makeTransferMoney({
    ...deps,
    transition,
    reconcileIntent,
    authorizeTransfer,
    dispatchTransfer,
  });
  return {
    transferMoney,
    findProposal: makeFindProposal(deps),
    confirmProposal: makeConfirmProposal({ ...deps, transferMoney }),
    getOperationStatus: makeGetOperationStatus(deps),
    reconcileIntent,
    listPendingTransfers: makeListPendingTransfers({ ...deps, reconcileIntent }),
    listLiveProposals: makeListLiveProposals(deps),
    getConversationTransfers: makeGetConversationTransfers({ ...deps, reconcileIntent }),
    /** Tests only: the services, wired to the same deps. */
    internals: { transition, authorizeTransfer, dispatchTransfer, dispatching: deps.dispatching },
  };
}
/** What index.ts exposes: the use cases, never the internals. */
export type TransfersApp = Omit<ReturnType<typeof wireTransfers>, 'internals'>;
let graph: TransfersApp | undefined;
export const transfers = (): TransfersApp => (graph ??= wireTransfers());
