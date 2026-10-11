import { eur } from './case-format';
import { recipientOf } from './verified-facts';
import type { CaseEvidence } from './case-evidence';
import type { Finding } from './case-findings';
import type { Claim, ClaimVerdict } from './claims';

export type TimelineEntry = {
  /** ISO; the UI formats it. */
  at: string;
  kind: 'message' | 'tool' | 'intent' | 'operation' | 'case';
  actor: 'customer' | 'assistant' | 'operator' | 'bank' | 'system';
  /** Written by code, never by a model. */
  label: string;
  /** The message, event, intent, operation or incident id. */
  sourceId: string;
  flag: 'unlinked_operation' | 'contradicted' | 'retry_advice' | null;
};

const KIND_RANK: Record<TimelineEntry['kind'], number> = {
  case: 0,
  message: 1,
  tool: 2,
  intent: 3,
  operation: 4,
};
const ACTOR: Record<string, TimelineEntry['actor']> = {
  user: 'customer',
  assistant: 'assistant',
  operator: 'operator',
};
const INTENT_STATUS: Record<string, string> = {
  created: 'prepared, not sent',
  requires_confirmation: 'awaiting confirmation',
  processing: 'being verified',
  completed: 'completed',
  failed: 'not completed',
  unknown: 'outcome unknown',
};
/** A tool name as recorded; anything that is not a plain tool name is not echoed. */
const toolName = (data: unknown) => {
  const tool = (data as { tool?: unknown } | null)?.tool;
  return typeof tool === 'string' && /^[a-z_]{1,40}$/.test(tool) ? tool : 'unknown tool';
};

/**
 * The case as one ordered list (plan Part 2 §4.A.4): messages, tool outcomes (`tool.completed`,
 * `tool.failed`; `tool.started` is noise), intents, window operations and earlier closed cases.
 * Sorted by time, then `case < message < tool < intent < operation`, then id. Event error text is
 * never copied into a label: it is external text and stays in the raw evidence.
 */
export function buildTimeline(
  evidence: CaseEvidence,
  claims: Claim[],
  verdicts: ClaimVerdict[],
  findings: Finding[],
): TimelineEntry[] {
  const retried = new Set(
    findings.flatMap((f) => (f.kind === 'retry_advice' ? [f.messageId] : [])),
  );
  const contradicted = new Set(
    verdicts
      .filter((v) => v.verdict === 'contradicted')
      .map((v) => claims.find((c) => c.id === v.claimId)?.messageId),
  );
  const entries: TimelineEntry[] = [
    ...evidence.previousCases.map((c) => ({
      at: c.created_at,
      kind: 'case' as const,
      actor: 'system' as const,
      label: `Previous case ${c.id}, closed`,
      sourceId: c.id,
      flag: null,
    })),
    ...evidence.messages.map((m) => ({
      at: m.created_at,
      kind: 'message' as const,
      actor: ACTOR[m.role] ?? 'system',
      label: m.content,
      sourceId: m.id,
      flag: retried.has(m.id)
        ? ('retry_advice' as const)
        : contradicted.has(m.id)
          ? ('contradicted' as const)
          : null,
    })),
    ...evidence.events
      .filter((e) => e.kind === 'tool.completed' || e.kind === 'tool.failed')
      .map((e) => ({
        at: e.created_at,
        kind: 'tool' as const,
        actor: 'assistant' as const,
        label:
          e.kind === 'tool.completed'
            ? `Tool ${toolName(e.data)} completed`
            : `Tool ${toolName(e.data)} failed · Bank error recorded`,
        sourceId: e.id,
        flag: null,
      })),
    ...evidence.intents.map((i) => ({
      at: i.created_at,
      kind: 'intent' as const,
      actor: 'system' as const,
      label: `App: transfer request ${eur(i.payload.amountCents)} to ${recipientOf(evidence, i.payload.toAccountId)} · now ${INTENT_STATUS[i.status] ?? 'outcome unknown'}${i.bank_reference ? ` (${i.bank_reference})` : ''}`,
      sourceId: i.id,
      flag: null,
    })),
    ...(evidence.allOperations ?? []).map((o) => ({
      at: o.createdAt,
      kind: 'operation' as const,
      actor: 'bank' as const,
      label: `Bank: ${eur(o.amountCents)} to ${recipientOf(evidence, o.toAccountId)} · completed (${o.reference})`,
      sourceId: o.id,
      flag: o.linkedIntentId === null ? ('unlinked_operation' as const) : null,
    })),
  ];
  return entries.sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.sourceId.localeCompare(b.sourceId),
  );
}
