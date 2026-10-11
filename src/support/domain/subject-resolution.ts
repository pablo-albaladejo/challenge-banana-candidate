import type { CaseEvidence, EvidenceIntent, WindowOperation } from './case-evidence';
import type { Claim, ClaimStatus, Evidence } from './claims';

/** What a transfer claim is about: a bank operation, or an intent (with its operation, if any). */
export type Subject =
  | { kind: 'operation'; operation: WindowOperation }
  | { kind: 'intent'; intent: EvidenceIntent; operation: WindowOperation | null };

export const operationEvidence = (o: { id: string }): Evidence => ({
  kind: 'operation',
  id: o.id,
  citation: `${o.id} (bank)`,
});
export const intentEvidence = (i: { id: string }): Evidence => ({
  kind: 'intent',
  id: i.id,
  citation: `${i.id} (app)`,
});

/** The intent behind a subject, if it has one. */
export const intentOf = (s: Subject): EvidenceIntent | null =>
  s.kind === 'intent' ? s.intent : null;
/** When a subject happened: its bank operation's time, else its intent's. */
export const subjectAt = (s: Subject) => s.operation?.createdAt ?? intentOf(s)!.created_at;
/** The id a subject is known by: its bank operation's, else its intent's. */
export const subjectId = (s: Subject) => (s.operation ?? intentOf(s)!).id;
export const amountOf = (s: Subject) =>
  s.kind === 'operation' ? s.operation.amountCents : s.intent.payload.amountCents;
export const referenceOf = (s: Subject) =>
  s.kind === 'operation' ? s.operation.reference : s.intent.bank_reference;
export const evidenceOf = (s: Subject): Evidence[] =>
  s.kind === 'operation'
    ? [operationEvidence(s.operation)]
    : [intentEvidence(s.intent), ...(s.operation ? [operationEvidence(s.operation)] : [])];

const asIntentSubject = (intent: EvidenceIntent, evidence: CaseEvidence): Subject => ({
  kind: 'intent',
  intent,
  operation: evidence.allOperations?.find((o) => o.linkedIntentId === intent.id) ?? null,
});

/** Every transfer the case is about: its window operations, and its intents with no window operation. */
export function subjectsOf(evidence: CaseEvidence): Subject[] {
  const linked = new Set(evidence.allOperations?.map((o) => o.linkedIntentId) ?? []);
  return [
    ...(evidence.allOperations ?? []).map((operation): Subject =>
      operation.linkedIntentId
        ? {
            kind: 'intent',
            intent: evidence.intents.find((i) => i.id === operation.linkedIntentId)!,
            operation,
          }
        : { kind: 'operation', operation },
    ),
    ...evidence.intents.filter((i) => !linked.has(i.id)).map((i) => asIntentSubject(i, evidence)),
  ];
}

/**
 * The status the evidence establishes for a subject, or why it cannot. A bank operation exists only
 * once committed. A stored `failed`, `processing` or `unknown` is trusted only when the bank could be
 * asked: with the bank unreachable, reconcile could not check it, and it settles nothing.
 */
export function mappedStatus(
  subject: Subject,
  bankReachable: boolean,
): { status: ClaimStatus } | { reason: 'outcome_unknown' | 'bank_unreachable' } {
  if (subject.kind === 'operation' || subject.operation) return { status: 'completed' };
  const { status } = subject.intent;
  if (status === 'completed') return { status: 'completed' };
  if (status === 'created' || status === 'requires_confirmation')
    return { status: 'not_completed' };
  if (!bankReachable) return { reason: 'bank_unreachable' };
  if (status === 'failed') return { status: 'not_completed' };
  if (status === 'processing') return { status: 'pending' };
  return { reason: 'outcome_unknown' };
}

type Resolution =
  { subject: Subject } | { reason: 'no_subject_found' | 'ambiguous_subject' | 'bank_unreachable' };

/**
 * The subject of an amount, reference or status claim; the first rule with any candidate wins:
 * (1) the claim's reference, on an intent of the conversation or else a window operation; (2) the
 * conversation's intents; (3) the window operations. Several candidates are told apart by the
 * claim's amount only; one candidate is never filtered away by its amount.
 */
export function resolveSubject(claim: Claim, evidence: CaseEvidence): Resolution {
  const operations = evidence.allOperations ?? [];
  const reference = 'reference' in claim ? claim.reference : null;
  const byReference: Subject[] = reference
    ? evidence.intents.some((i) => i.bank_reference === reference)
      ? evidence.intents
          .filter((i) => i.bank_reference === reference)
          .map((i) => asIntentSubject(i, evidence))
      : subjectsOf(evidence).filter((s) => s.kind === 'operation' && referenceOf(s) === reference)
    : [];
  const rules: Subject[][] = [
    byReference,
    evidence.intents.map((i) => asIntentSubject(i, evidence)),
    operations
      .filter((o) => !o.linkedIntentId)
      .map((operation) => ({ kind: 'operation', operation })),
  ];
  const candidates = rules.find((r) => r.length > 0);
  if (!candidates)
    return { reason: evidence.allOperations === null ? 'bank_unreachable' : 'no_subject_found' };
  if (candidates.length === 1) return { subject: candidates[0] };
  const amount = 'amountCents' in claim ? claim.amountCents : null;
  const matching = candidates.filter((s) => amount !== null && amountOf(s) === amount);
  return matching.length === 1 ? { subject: matching[0] } : { reason: 'ambiguous_subject' };
}
