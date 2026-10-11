import { createHash } from 'node:crypto';
import { insertEvent } from '../../platform/telemetry/events.repo';
import type { CaseEvents } from '../application/ports/case-events';
import type { CaseEvidence } from '../domain/case-evidence';

/** sha256 of the canonical evidence a brief judged: ids, statuses and amounts, no customer text. */
export const evidenceHash = (evidence: CaseEvidence) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        messages: evidence.messages.map((m) => m.id),
        intents: evidence.intents.map((i) => [i.id, i.status, i.bank_reference]),
        operations: evidence.allOperations?.map((o) => [o.id, o.amountCents]) ?? null,
      }),
    )
    .digest('hex');

const countBy = (keys: string[]) =>
  keys.reduce<Record<string, number>>(
    (counts, key) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 }),
    {},
  );

/** `case.brief_generated` in the case conversation's events, written as the operator. */
export const telemetryCaseEvents: CaseEvents = {
  briefGenerated: ({ id, operatorId, evidence, brief }) =>
    insertEvent({
      id,
      runId: `brief-${id}`,
      userId: operatorId,
      conversationId: evidence.conversation.id,
      kind: 'case.brief_generated',
      data: JSON.stringify({
        incidentId: brief.incidentId,
        mode: brief.mode,
        degradedReason: brief.degradedReason,
        verdicts: countBy(brief.verdicts.map((v) => `${v.verdict}:${v.reason}`)),
        dropped: brief.dropped,
        flags: countBy(brief.prose?.flags.map((f) => f.kind) ?? []),
        findings: brief.findings.map((f) => f.kind),
        procedures: brief.procedures.map((p) => p.citation),
        promptVersion: brief.promptVersion,
        evidenceHash: evidenceHash(evidence),
      }),
      createdAt: brief.generatedAt,
    }),
};
