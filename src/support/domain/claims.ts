import type { Product } from '../../shared/domain/policy-rules';
import type { ClaimStatus, ScannedStatus } from './scanners';

export type { ClaimStatus, ScannedStatus };
export type PolicyKind =
  'monthly_fee' | 'internal_transfer_fee' | 'per_transfer_limit' | 'referral_reward' | 'other';

/** Why the clause around a pattern-matched claim is not one the oracle may judge (plan §4.A.5). */
export type UnjudgedReason =
  'ambiguous_status' | 'no_subject_found' | 'ambiguous_subject' | 'unanchored_amount';

type ClaimBase = {
  /** `${messageId}#${index}` */
  id: string;
  messageId: string;
  /** Verbatim substring of the message content. */
  quote: string;
  extractedBy: 'model' | 'regex';
  /**
   * Pattern-matched claims only: `null` when the clause around the match has the whitelisted shape,
   * else why not. A regex claim without it is never judged ✅ or ❌.
   */
  unjudged?: UnjudgedReason | null;
};

/** A statement the assistant made to the customer, to be judged by `verifyClaim`. */
export type Claim = ClaimBase &
  (
    | { kind: 'amount'; amountCents: number; reference: string | null }
    | { kind: 'reference'; reference: string }
    | {
        kind: 'operation_status';
        /** `ambiguous_status`: a negated or hedged phrase; always judged ⚪, never dropped. */
        status: ScannedStatus;
        amountCents: number | null;
        reference: string | null;
      }
    | { kind: 'policy_amount'; policy: PolicyKind; product: Product | null; amountCents: number }
  );

export type VerdictReason =
  // verified
  | 'matches_operation'
  | 'matches_intent'
  | 'never_dispatched'
  | 'matches_policy'
  // contradicted
  | 'contradicted_by_operation'
  | 'contradicted_by_intent'
  | 'contradicted_by_policy'
  | 'policy_unpublished'
  // unverifiable
  | 'no_subject_found'
  | 'ambiguous_subject'
  | 'ambiguous_status'
  | 'unanchored_amount'
  | 'bank_unreachable'
  | 'outcome_unknown'
  | 'conditional_policy'
  | 'no_policy_entry'
  | 'not_extracted';

/** What a verdict or a fact rests on. */
export type Evidence = {
  kind: 'operation' | 'intent' | 'policy' | 'movement';
  id: string;
  /** `op-historic-lucia (bank)` | `[aurora-fees-2026 v2]` */
  citation: string;
};

/**
 * The oracle's answer for one claim. `unverifiable` carries no evidence and no score: nothing (UI,
 * metrics, draft) ever counts it as verified. `correctFactId` names the fact that holds instead.
 */
export type ClaimVerdict =
  | { claimId: string; verdict: 'verified'; reason: VerdictReason; evidence: Evidence[] }
  | {
      claimId: string;
      verdict: 'contradicted';
      reason: VerdictReason;
      evidence: Evidence[];
      correctFactId: string;
    }
  | { claimId: string; verdict: 'unverifiable'; reason: VerdictReason; detail: string };

/**
 * How many claims were verified (✅). A ⚪ verdict is never counted, whatever its reason: the
 * metric of plan Part 2 §7.1 and §7.5.
 */
export const countVerified = (verdicts: ClaimVerdict[]) =>
  verdicts.filter((v) => v.verdict === 'verified').length;

/** A ⚪ verdict: why the claim could not be judged, with no evidence. */
export const unverifiable = (
  claim: Pick<Claim, 'id'>,
  reason: VerdictReason,
  detail: string,
): ClaimVerdict => ({ claimId: claim.id, verdict: 'unverifiable', reason, detail });

/** A fact code established, with the customer-facing sentence code wrote for it. */
export type VerifiedFact = {
  /** `F1`, `F2`, … in timeline order, policy facts last. */
  id: string;
  kind: 'amount' | 'reference' | 'status' | 'date' | 'policy';
  /** Normalised: `EUR 85.00` | `ref-historic-lucia` | `completed` | `2026-09-23` | `EUR 6.00`. */
  value: string;
  statement: string;
  evidence: Evidence[];
};
