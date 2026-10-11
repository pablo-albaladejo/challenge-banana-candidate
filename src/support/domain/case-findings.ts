import { amountOf, mappedStatus, referenceOf, subjectId, subjectsOf } from './subject-resolution';
import { scanAmounts, scanCommitments, scanReferences } from './scanners';
import type { CaseEvidence } from './case-evidence';
import type { Claim, ClaimVerdict } from './claims';

/** What the operator must act on, most severe first (the order of this union). */
export type Finding =
  | { kind: 'unlinked_operation'; operationId: string }
  | { kind: 'retry_advice'; messageId: string; subjectId: string }
  | { kind: 'false_status_claim'; claimId: string }
  | { kind: 'unsettled_intent'; intentId: string }
  | { kind: 'pending_twin'; intentIds: string[] }
  | { kind: 'false_other_claim'; claimId: string }
  | { kind: 'policy_claim'; claimId: string }
  | { kind: 'bank_unreachable'; cause: 'unreachable' | 'refused' }
  | { kind: 'missing_agent_activity' };

export const FINDING_ORDER: Finding['kind'][] = [
  'unlinked_operation',
  'retry_advice',
  'false_status_claim',
  'unsettled_intent',
  'pending_twin',
  'false_other_claim',
  'policy_claim',
  'bank_unreachable',
  'missing_agent_activity',
];

const UNSETTLED = new Set(['unknown', 'processing']);

/**
 * The findings of a case (plan Part 2 §4.A.6), all decided by code. `retry_advice` is the Lucía
 * finding: the assistant told the customer to send again a transfer the evidence shows completed,
 * an intent of the conversation or, when it has none, a window operation (subject rule 3). Among
 * several completed ones it names the one whose reference or amount the message states, else the
 * first. It does not read the message time: the bank may book a transfer after the message that advised retrying
 * it (Lucía's seeded case), and a false blocker is cheaper than a payment made twice.
 */
export function findingsOf(
  evidence: CaseEvidence,
  claims: Claim[],
  verdicts: ClaimVerdict[],
): Finding[] {
  const bankReachable = evidence.allOperations !== null;
  const claimOf = (v: ClaimVerdict) => claims.find((c) => c.id === v.claimId);
  // The subjects of rule 2 (the conversation's intents, with their operations) or, only when the
  // conversation has none, of rule 3 (the window operations no intent holds).
  const completed = subjectsOf(evidence)
    .filter((s) => (evidence.intents.length ? s.kind === 'intent' : s.kind === 'operation'))
    .filter((s) => {
      const mapped = mappedStatus(s, bankReachable);
      return 'status' in mapped && mapped.status === 'completed';
    });
  /** The completed subject a message names by reference or amount, else the first one. */
  const adviceSubject = (content: string) => {
    const references = scanReferences(content).map((r) => r.value);
    const amounts = scanAmounts(content).map((a) => a.cents);
    return (
      completed.find(
        (s) => references.includes(referenceOf(s) ?? '') || amounts.includes(amountOf(s)),
      ) ?? completed[0]
    );
  };
  const byPayload = new Map<string, string[]>();
  for (const i of evidence.intents.filter((i) => UNSETTLED.has(i.status))) {
    const key = JSON.stringify(i.payload);
    byPayload.set(key, [...(byPayload.get(key) ?? []), i.id]);
  }
  const twins = [...byPayload.values()].filter((ids) => ids.length > 1);
  const findings: Finding[] = [
    ...(evidence.allOperations ?? [])
      .filter((o) => o.linkedIntentId === null)
      .map((o) => ({ kind: 'unlinked_operation' as const, operationId: o.id })),
    ...(completed.length
      ? evidence.messages
          .filter(
            (m) => m.role === 'assistant' && scanCommitments(m.content, []).some((c) => c.retry),
          )
          .map((m) => ({
            kind: 'retry_advice' as const,
            messageId: m.id,
            subjectId: subjectId(adviceSubject(m.content)),
          }))
      : []),
    ...verdicts
      .filter((v) => v.verdict === 'contradicted' && claimOf(v)?.kind === 'operation_status')
      .map((v) => ({ kind: 'false_status_claim' as const, claimId: v.claimId })),
    ...evidence.intents
      .filter((i) => UNSETTLED.has(i.status))
      .map((i) => ({ kind: 'unsettled_intent' as const, intentId: i.id })),
    ...twins.map((intentIds) => ({ kind: 'pending_twin' as const, intentIds })),
    ...verdicts
      .filter((v) => v.verdict === 'contradicted' && claimOf(v)?.kind === 'amount')
      .map((v) => ({ kind: 'false_other_claim' as const, claimId: v.claimId })),
    ...claims
      .filter((c) => c.kind === 'policy_amount')
      .map((c) => ({ kind: 'policy_claim' as const, claimId: c.id })),
    ...(bankReachable
      ? []
      : [
          {
            kind: 'bank_unreachable' as const,
            cause:
              evidence.bankFailure === 'refused' ? ('refused' as const) : ('unreachable' as const),
          },
        ]),
    ...(evidence.events.length ? [] : [{ kind: 'missing_agent_activity' as const }]),
  ];
  return findings;
}
