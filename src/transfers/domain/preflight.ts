import { policyFor, productOfAccount } from '../../shared/domain/policy-rules';
import { preflightMessages } from './preflight-messages';
import type { Account, TransferInput } from '../../types';

export type PreflightSeverity = 'info' | 'warning' | 'blocker';

export type PreflightSource =
  | { kind: 'bank'; what: 'balance' | 'movements'; asOf: string }
  | { kind: 'history'; what: 'completed_transfers' | 'outgoing_movements'; sampleSize: number }
  | { kind: 'safeguard'; id: 'P0-4' };

export type PreflightCheck = {
  id:
    | 'balance_after'
    | 'first_time_recipient'
    | 'unusual_amount'
    | 'pending_twin'
    | 'history_unavailable';
  severity: PreflightSeverity;
  /** The final customer-facing sentence, built by code. */
  message: string;
  source: PreflightSource;
};

/** Below this many outgoing payments the history is too thin to call an amount unusual. */
export const UNUSUAL_MIN_SAMPLE = 3;
/** An unusual amount is more than this many times the median outgoing payment … */
export const UNUSUAL_MEDIAN_FACTOR = 3;
/** How many failed/unknown intents to the recipient are reconciled before deciding "first time". */
export const FIRST_TIME_RECONCILE_LIMIT = 3;

/** An intent of the customer as the checks read it: its status and stored payload JSON. */
export type PreflightIntent = { id: string; status: string; payload: string };

export type PreflightInput = {
  transfer: TransferInput;
  accounts: Account[];
  contacts: { id: string; name?: string }[];
  /** The customer's intents, read after the first-time reconcile. */
  intents: PreflightIntent[];
  /** The customer's movements; `null` when the bank could not list them. */
  movements: { amountCents: number }[] | null;
  /** The newest pending twin, only when the customer chose to send past it. */
  overriddenTwin: { created_at: string } | null;
  /** When the bank data was read. */
  asOf: string;
};

/** The recipient of a stored intent; `undefined` when its payload cannot be read. */
function toAccountOf(intent: PreflightIntent): unknown {
  try {
    return (JSON.parse(intent.payload) as Partial<TransferInput> | null)?.toAccountId;
  } catch {
    return undefined;
  }
}
const paidTo = (intents: PreflightIntent[], toAccountId: string) =>
  intents.some((i) => i.status === 'completed' && toAccountOf(i) === toAccountId);

/**
 * The intents to reconcile before deciding "first time": a stored `failed` or `unknown` can hide a
 * payment the bank completed (the historic Lucía → Bruno transfer). None once a `completed` intent
 * to the recipient exists; otherwise the newest `FIRST_TIME_RECONCILE_LIMIT` of them. `intents`
 * are the customer's, newest first. `excludedIds` (the intent asking and its pending twins) are
 * never reconciled here: settling a twin is the hold's job, and doing it after the hold was read
 * would turn a held transfer into a fresh proposal.
 */
export function firstTimeReconcileCandidates(
  intents: PreflightIntent[],
  toAccountId: string,
  excludedIds: string[] = [],
) {
  if (paidTo(intents, toAccountId)) return [];
  return intents
    .filter(
      (i) =>
        (i.status === 'failed' || i.status === 'unknown') &&
        !excludedIds.includes(i.id) &&
        toAccountOf(i) === toAccountId,
    )
    .slice(0, FIRST_TIME_RECONCILE_LIMIT)
    .map((i) => i.id);
}

/** The median, the floored mean of the two middle values for an even count. */
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.floor((sorted[middle - 1] + sorted[middle]) / 2);
}

function balanceAfter({ transfer, accounts, asOf }: PreflightInput): PreflightCheck | null {
  const from = accounts.find((a) => a.id === transfer.fromAccountId);
  if (!from) return null;
  const fee = policyFor('internal_transfer_fee', productOfAccount(from.label));
  const feeCents = fee?.rule.kind === 'internal_transfer_fee' ? fee.rule.amountCents : 0;
  const after = from.balanceCents - transfer.amountCents - feeCents;
  const source: PreflightSource = { kind: 'bank', what: 'balance', asOf };
  return after < 0
    ? {
        id: 'balance_after',
        severity: 'blocker',
        message: preflightMessages.balanceShort(from.label, from.balanceCents, -after),
        source,
      }
    : {
        id: 'balance_after',
        severity: 'info',
        message: preflightMessages.balanceAfter(from.label, after),
        source,
      };
}

function firstTimeRecipient({
  transfer,
  accounts,
  contacts,
  intents,
}: PreflightInput): PreflightCheck | null {
  const { toAccountId } = transfer;
  if (accounts.some((a) => a.id === toAccountId) || paidTo(intents, toAccountId)) return null;
  const name = contacts.find((c) => c.id === toAccountId)?.name ?? null;
  return {
    id: 'first_time_recipient',
    severity: 'warning',
    message: preflightMessages.firstTimeRecipient(name),
    source: {
      kind: 'history',
      what: 'completed_transfers',
      sampleSize: intents.filter((i) => i.status === 'completed').length,
    },
  };
}

function unusualAmount({ transfer, movements, asOf }: PreflightInput): PreflightCheck | null {
  if (!movements)
    return {
      id: 'history_unavailable',
      severity: 'info',
      message: preflightMessages.historyUnavailable(),
      source: { kind: 'bank', what: 'movements', asOf },
    };
  const payments = movements.filter((m) => m.amountCents < 0).map((m) => -m.amountCents);
  if (payments.length < UNUSUAL_MIN_SAMPLE) return null;
  const largest = Math.max(...payments);
  const { amountCents } = transfer;
  if (amountCents <= UNUSUAL_MEDIAN_FACTOR * median(payments) || amountCents <= largest)
    return null;
  return {
    id: 'unusual_amount',
    severity: 'warning',
    message: preflightMessages.unusualAmount(largest),
    source: { kind: 'history', what: 'outgoing_movements', sampleSize: payments.length },
  };
}

function pendingTwin({ overriddenTwin }: PreflightInput): PreflightCheck | null {
  if (!overriddenTwin) return null;
  return {
    id: 'pending_twin',
    severity: 'warning',
    message: preflightMessages.pendingTwin(overriddenTwin.created_at),
    source: { kind: 'safeguard', id: 'P0-4' },
  };
}

/**
 * The advisory checks of a transfer proposal, in rule order: balance after, first-time recipient,
 * unusual amount (or `history_unavailable`), pending twin. They never change the decision: the
 * bank stays the authority on funds.
 */
export function preflightChecks(input: PreflightInput): PreflightCheck[] {
  return [
    balanceAfter(input),
    firstTimeRecipient(input),
    unusualAmount(input),
    pendingTwin(input),
  ].filter((c): c is PreflightCheck => c !== null);
}
