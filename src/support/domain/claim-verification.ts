import type { CaseEvidence } from './case-evidence';
import { unverifiable, type Claim, type ClaimVerdict, type VerdictReason } from './claims';
import { verifyPolicy } from './policy-verification';
import {
  amountOf,
  evidenceOf,
  intentEvidence,
  mappedStatus,
  operationEvidence,
  referenceOf,
  resolveSubject,
  subjectId,
  type Subject,
} from './subject-resolution';

const DETAIL = {
  no_subject_found: 'No transfer request or bank operation of this conversation matches it.',
  ambiguous_subject: 'Several transfers of this conversation could match it.',
  bank_unreachable: 'The bank could not be reached, so it could not be checked.',
  bank_refused: 'The bank answered with an error, so it could not be checked.',
  outcome_unknown: 'The bank has not confirmed the outcome of this transfer yet.',
  ambiguous_status:
    'The sentence negates or hedges the status, so it states none that can be checked.',
  unanchored_amount:
    'The sentence names no transfer status or reference beside it, so this amount may not be about a transfer.',
  no_transfer: 'The sentence names no transfer, so it may not be about one.',
  several_subjects:
    'The sentence names several amounts or references, so it may be about several transfers.',
  other_reference: 'No transfer of this conversation holds the reference the sentence names.',
  other_amount: 'No transfer of this conversation has the amount the sentence names.',
} as const;

/** Why a claim could not be judged, in words; a bank that refused is not called unreachable. */
const detailOf = (reason: keyof typeof DETAIL, evidence: CaseEvidence) =>
  reason === 'bank_unreachable' && evidence.bankFailure === 'refused'
    ? DETAIL.bank_refused
    : DETAIL[reason];

const UNJUDGED_DETAIL = {
  ambiguous_status: DETAIL.ambiguous_status,
  no_subject_found: DETAIL.no_transfer,
  ambiguous_subject: DETAIL.several_subjects,
  unanchored_amount: DETAIL.unanchored_amount,
} as const;

/**
 * Why a pattern-matched amount or status claim may not be judged against `subject`, or `null` when
 * it may (plan Part 2 §4.A.5, conservative by default): its clause must have the whitelisted shape
 * (`unjudged === null`; missing counts as not), its reference must be the subject's, and, unless a
 * reference names the subject, its amount must be the subject's. "Your previous EUR 6 payment
 * failed" is never judged against the case's EUR 85 transfer.
 */
function regexGate(
  claim: Extract<Claim, { kind: 'amount' | 'operation_status' }>,
  subject: Subject,
): { reason: VerdictReason; detail: string } | null {
  if (claim.unjudged !== null) {
    const reason = claim.unjudged ?? 'ambiguous_status';
    return { reason, detail: UNJUDGED_DETAIL[reason] };
  }
  if (claim.reference !== null && referenceOf(subject) !== claim.reference)
    return { reason: 'no_subject_found', detail: DETAIL.other_reference };
  if (
    claim.reference === null &&
    claim.amountCents !== null &&
    amountOf(subject) !== claim.amountCents
  )
    return { reason: 'no_subject_found', detail: DETAIL.other_amount };
  return null;
}

/** The fact key a verdict points at before `verifiedFacts` numbers the facts. */
const statusKey = (s: Subject) => `status:${subjectId(s)}`;
const amountKey = (s: Subject) => `amount:${subjectId(s)}`;

const verdictOn = (
  claim: Claim,
  subject: Subject,
  equal: boolean,
  correctKey: string,
  never = false,
): ClaimVerdict =>
  equal
    ? {
        claimId: claim.id,
        verdict: 'verified',
        reason: never
          ? 'never_dispatched'
          : subject.operation
            ? 'matches_operation'
            : 'matches_intent',
        evidence: evidenceOf(subject),
      }
    : {
        claimId: claim.id,
        verdict: 'contradicted',
        reason: subject.operation ? 'contradicted_by_operation' : 'contradicted_by_intent',
        evidence: evidenceOf(subject),
        correctFactId: correctKey,
      };

/**
 * The oracle (plan Part 2 §4.A.5): judges one claim against the evidence and the policy rules.
 * Absence of evidence is never a contradiction, and nothing the bank could not confirm is verified.
 * An ambiguous status is ⚪ `ambiguous_status`. A pattern-matched amount or status is judged only
 * when its clause has the whitelisted shape and names the subject (`regexGate`); otherwise it is ⚪,
 * never ✅ or ❌. A reference is judged on the exact identifier, whoever extracted it.
 * A contradicted verdict's `correctFactId` is a fact key until `verifiedFacts` numbers the facts.
 */
export function verifyClaim(claim: Claim, evidence: CaseEvidence): ClaimVerdict {
  if (claim.kind === 'policy_amount') return verifyPolicy(claim, evidence);
  if (claim.kind === 'reference') {
    const reference = claim.reference;
    const intent =
      evidence.intents.find((i) => i.bank_reference === reference) ??
      evidence.customerReferences.find((i) => i.bank_reference === reference);
    const operation = evidence.allOperations?.find((o) => o.reference === reference);
    if (intent || operation)
      return {
        claimId: claim.id,
        verdict: 'verified',
        reason: operation ? 'matches_operation' : 'matches_intent',
        evidence: [operation ? operationEvidence(operation) : intentEvidence(intent!)],
      };
    return evidence.allOperations === null
      ? unverifiable(claim, 'bank_unreachable', detailOf('bank_unreachable', evidence))
      : unverifiable(
          claim,
          'no_subject_found',
          'No transfer of this customer holds this reference.',
        );
  }
  if (claim.kind === 'operation_status' && claim.status === 'ambiguous_status')
    return unverifiable(claim, 'ambiguous_status', DETAIL.ambiguous_status);
  const resolution = resolveSubject(claim, evidence);
  if ('reason' in resolution)
    return unverifiable(claim, resolution.reason, detailOf(resolution.reason, evidence));
  const { subject } = resolution;
  const gate = claim.extractedBy === 'regex' ? regexGate(claim, subject) : null;
  if (gate) return unverifiable(claim, gate.reason, gate.detail);
  if (claim.kind === 'amount')
    return verdictOn(claim, subject, amountOf(subject) === claim.amountCents, amountKey(subject));
  const mapped = mappedStatus(subject, evidence.allOperations !== null);
  if ('reason' in mapped)
    return unverifiable(claim, mapped.reason, detailOf(mapped.reason, evidence));
  const never =
    claim.status === 'not_completed' &&
    subject.kind === 'intent' &&
    !subject.operation &&
    (subject.intent.status === 'created' || subject.intent.status === 'requires_confirmation');
  return verdictOn(claim, subject, mapped.status === claim.status, statusKey(subject), never);
}
