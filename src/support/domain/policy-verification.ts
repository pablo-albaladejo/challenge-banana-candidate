import {
  POLICY_RULES,
  inForce,
  policyFor,
  productOfAccount,
  type PolicyEntry,
  type Product,
} from '../../shared/domain/policy-rules';
import { referenceDate } from '../../shared/domain/reference-date';
import { eur, madridDate } from './case-format';
import type { CaseEvidence, EvidenceMovement } from './case-evidence';
import { unverifiable, type Claim, type ClaimVerdict, type Evidence } from './claims';

export type PolicyClaim = Extract<Claim, { kind: 'policy_amount' }>;

export const policyEvidence = (e: PolicyEntry): Evidence => ({
  kind: 'policy',
  id: e.documentId,
  citation: `[${e.documentId} v${e.version}]`,
});

/**
 * The fact key of a policy entry's value (or of one part of a waiver), before `verifiedFacts`
 * numbers the facts.
 */
export const policyKey = (e: PolicyEntry, part = 'value') =>
  `policy:${e.documentId}:v${e.version}:${e.rule.kind}:${'topic' in e.rule ? e.rule.topic : part}`;

/** Products of the customer's accounts; none when the bank could not list them. */
export const productsHeld = (evidence: CaseEvidence): Product[] =>
  [...new Set((evidence.accounts ?? []).map((a) => productOfAccount(a.label)))].filter(
    (p): p is Product => p !== null,
  );

/** The unpublished-topic entries in force (`policyFor` covers every other kind, see policy-rules.ts). */
export const unpublishedOn = (onDate: string) =>
  POLICY_RULES.filter((e) => e.rule.kind === 'unpublished' && inForce(e, onDate));

/** The date a policy claim is judged on: its message's Madrid date, never after the reference date. */
const claimDate = (claim: Claim, evidence: CaseEvidence) => {
  const message = evidence.messages.find((m) => m.id === claim.messageId);
  const day = message ? madridDate(message.created_at) : evidence.caseDate;
  return day < referenceDate ? day : referenceDate;
};

type PolicyLookup =
  | { entry: PolicyEntry; onDate: string }
  | { reason: 'no_policy_entry' | 'ambiguous_subject' | 'bank_unreachable' };

/** The policy entry a policy claim is judged against, on the claim's date. */
export function policyEntryFor(claim: PolicyClaim, evidence: CaseEvidence): PolicyLookup {
  const onDate = claimDate(claim, evidence);
  if (claim.policy === 'other') return { reason: 'no_policy_entry' };
  if (claim.policy === 'referral_reward') {
    const entry = unpublishedOn(onDate).find(
      (e) => e.rule.kind === 'unpublished' && e.rule.topic === 'referral_reward',
    );
    return entry ? { entry, onDate } : { reason: 'no_policy_entry' };
  }
  if (!claim.product && evidence.accounts === null) return { reason: 'bank_unreachable' };
  const held = productsHeld(evidence);
  const product = claim.product ?? (held.length === 1 ? held[0] : null);
  const entry = policyFor(claim.policy, product, onDate);
  if (!entry) return { reason: product ? 'no_policy_entry' : 'ambiguous_subject' };
  return { entry, onDate };
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** The largest salary of the month of `onDate` (Madrid), by its `<Month> salary` description. */
export function salaryIn(movements: EvidenceMovement[], onDate: string) {
  const month = MONTHS[Number(onDate.slice(5, 7)) - 1];
  return movements
    .filter(
      (m) =>
        m.amountCents > 0 &&
        m.description.startsWith(`${month} salary`) &&
        madridDate(m.createdAt).slice(0, 7) === onDate.slice(0, 7),
    )
    .sort((a, b) => b.amountCents - a.amountCents)[0];
}

/** Each waiver condition the ledger can settle, in words: the salary one; card purchases cannot be. */
function waiverDetail(evidence: CaseEvidence, salaryCents: number, onDate: string) {
  const cards = 'card purchases cannot be determined from the ledger.';
  if (!evidence.movements)
    return `The ledger could not be read, so the salary condition is unknown; ${cards}`;
  const salary = salaryIn(evidence.movements, onDate);
  if (!salary) return `No salary payment was found that month; ${cards}`;
  const holds = salary.amountCents >= salaryCents;
  return `Salary condition ${holds ? 'holds' : 'is not met'} (${eur(salary.amountCents)} received, ${salary.id}); ${cards}`;
}

const LOOKUP_DETAIL = {
  no_policy_entry: 'No policy in force states this value.',
  ambiguous_subject: 'The customer holds several products, and the claim names none.',
  bank_unreachable: "The bank could not list the customer's accounts, so the product is unknown.",
} as const;

/** The verdict on a policy claim (plan Part 2 §4.A.5, the `policy_amount` row). */
export function verifyPolicy(claim: PolicyClaim, evidence: CaseEvidence): ClaimVerdict {
  const lookup = policyEntryFor(claim, evidence);
  if ('reason' in lookup) return unverifiable(claim, lookup.reason, LOOKUP_DETAIL[lookup.reason]);
  const { entry, onDate } = lookup;
  const contradicted = (reason: 'contradicted_by_policy' | 'policy_unpublished'): ClaimVerdict => ({
    claimId: claim.id,
    verdict: 'contradicted',
    reason,
    evidence: [policyEvidence(entry)],
    correctFactId: policyKey(entry),
  });
  if (entry.rule.kind === 'unpublished') return contradicted('policy_unpublished');
  if (!('amountCents' in entry.rule)) return unverifiable(claim, 'no_policy_entry', '');
  const waiver = entry.rule.kind === 'monthly_fee' ? entry.rule.waiver : null;
  if (waiver) {
    if (
      claim.amountCents === entry.rule.amountCents ||
      claim.amountCents === waiver.waivedAmountCents
    )
      return unverifiable(
        claim,
        'conditional_policy',
        waiverDetail(evidence, waiver.salaryCents, onDate),
      );
    return contradicted('contradicted_by_policy');
  }
  return claim.amountCents === entry.rule.amountCents
    ? {
        claimId: claim.id,
        verdict: 'verified',
        reason: 'matches_policy',
        evidence: [policyEvidence(entry)],
      }
    : contradicted('contradicted_by_policy');
}
