import { policyFor, type PolicyEntry } from '../../shared/domain/policy-rules';
import { eur, longDate, madridDate } from './case-format';
import type { CaseEvidence } from './case-evidence';
import type { Claim, ClaimVerdict, Evidence, VerifiedFact } from './claims';
import {
  MONTHS,
  policyEntryFor,
  policyEvidence,
  policyKey,
  productsHeld,
  salaryIn,
  unpublishedOn,
} from './policy-verification';
import {
  amountOf,
  evidenceOf,
  intentOf,
  mappedStatus,
  referenceOf,
  subjectAt,
  subjectId,
  subjectsOf,
  type Subject,
} from './subject-resolution';

const movementEvidence = (m: { id: string }): Evidence => ({
  kind: 'movement',
  id: m.id,
  citation: `${m.id} (bank)`,
});

/** Who received a transfer, in customer-facing words: a contact's name, never an account id. */
export function recipientOf(evidence: CaseEvidence, accountId: string) {
  const own = evidence.accounts?.find((a) => a.id === accountId);
  if (own) return `your ${own.label}`;
  const name = evidence.contacts?.find((c) => c.id === accountId)?.name;
  // Bank data on one plain line: control characters and newlines become spaces, capped at 80.
  const plain = name
    ?.replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 80);
  return plain || 'the recipient account';
}

/**
 * A fact before numbering. A policy fact carries its entry and the slot it fills (`kind:topic` or
 * `kind:part`), so one policy value is stated once whichever entry states it.
 */
type DraftFact = Omit<VerifiedFact, 'id'> & {
  key: string;
  policy?: { entry: PolicyEntry; slot: string };
};

function subjectFacts(subject: Subject, evidence: CaseEvidence): DraftFact[] {
  const amount = amountOf(subject);
  const reference = referenceOf(subject);
  const intent = intentOf(subject);
  const payload = subject.operation ?? intent!.payload;
  const at = subjectAt(subject);
  const to = recipientOf(evidence, payload.toAccountId);
  const ref = reference ? ` (${reference})` : '';
  const mapped = mappedStatus(subject, evidence.allOperations !== null);
  const status = 'status' in mapped ? mapped.status : null;
  const what = `transfer of ${eur(amount)} to ${to}`;
  const statement =
    status === 'completed'
      ? `The bank completed your ${what} on ${longDate(at)}${ref}.`
      : status === 'pending'
        ? `Your ${what} of ${longDate(at)} is still being verified with the bank${ref}.`
        : status === 'not_completed'
          ? intent && intent.status !== 'failed'
            ? `Your ${what} was prepared on ${longDate(at)} but was not sent to the bank.`
            : `Your ${what} of ${longDate(at)} was not completed${ref}.`
          : `You asked for a ${what} on ${longDate(at)}${ref}.`;
  const evidenceList = evidenceOf(subject);
  const fact = (kind: DraftFact['kind'], value: string): DraftFact => ({
    key: `${kind}:${subjectId(subject)}`,
    kind,
    value,
    statement,
    evidence: evidenceList,
  });
  return [
    fact('amount', eur(amount)),
    ...(reference ? [fact('reference', reference)] : []),
    ...(status ? [fact('status', status)] : []),
    fact('date', madridDate(at)),
  ];
}

const productLabel = (p: string) => p[0].toUpperCase() + p.slice(1);
const TOPIC_WORDS = {
  referral_reward: 'referral rewards',
  mortgage: 'mortgages',
  travel_insurance: 'travel insurance',
};

function policyFacts(entry: PolicyEntry): DraftFact[] {
  const rule = entry.rule;
  const fact = (value: string, statement: string, part?: string): DraftFact => ({
    key: policyKey(entry, part),
    kind: 'policy',
    value,
    statement,
    evidence: [policyEvidence(entry)],
    policy: { entry, slot: `${rule.kind}:${'topic' in rule ? rule.topic : (part ?? 'value')}` },
  });
  if (rule.kind === 'unpublished')
    return [
      fact(
        'not specified',
        `Banana Bank's documentation does not specify ${TOPIC_WORDS[rule.topic]}.`,
      ),
    ];
  if (rule.kind === 'internal_transfer_fee')
    return [
      fact(
        eur(rule.amountCents),
        'Standard internal transfers between Banana Bank accounts have no fee.',
      ),
    ];
  if (rule.kind === 'per_transfer_limit')
    return [
      fact(eur(rule.amountCents), `A single transfer can be up to ${eur(rule.amountCents)}.`),
    ];
  const label = productLabel(rule.product);
  const fee = fact(
    eur(rule.amountCents),
    `The ${label} account monthly fee is ${eur(rule.amountCents)}.`,
  );
  if (!rule.waiver) return [fee];
  const terms = `The ${label} account monthly fee is waived (${eur(rule.waiver.waivedAmountCents)}) only when both requirements are met in the same month: a salary payment of at least ${eur(rule.waiver.salaryCents)} and ${rule.waiver.cardPurchases} settled card purchases.`;
  return [
    fee,
    fact(eur(rule.waiver.waivedAmountCents), terms, 'waived'),
    fact(eur(rule.waiver.salaryCents), terms, 'salary'),
    fact(`${rule.waiver.cardPurchases} card purchases`, terms, 'cards'),
  ];
}

/** The salary the waiver conditions read, as a fact, for every waiver entry of the customer's products. */
function waiverConditionFacts(entries: PolicyEntry[], evidence: CaseEvidence): DraftFact[] {
  const hasWaiver = entries.some((e) => e.rule.kind === 'monthly_fee' && e.rule.waiver);
  const salary =
    hasWaiver && evidence.movements ? salaryIn(evidence.movements, evidence.caseDate) : undefined;
  if (!salary) return [];
  const month = MONTHS[Number(evidence.caseDate.slice(5, 7)) - 1];
  return [
    {
      key: `amount:${salary.id}`,
      kind: 'amount',
      value: eur(salary.amountCents),
      statement: `A ${month} salary of ${eur(salary.amountCents)} was received (${salary.id}).`,
      evidence: [movementEvidence(salary)],
    },
  ];
}

/** Every policy entry in force on the case date for the customer's products, the product-null ones and the unpublished topics. */
function casePolicyEntries(evidence: CaseEvidence): PolicyEntry[] {
  const on = evidence.caseDate;
  const kinds = ['monthly_fee', 'internal_transfer_fee', 'per_transfer_limit'] as const;
  return [
    ...productsHeld(evidence).flatMap((p) => kinds.map((k) => policyFor(k, p, on))),
    policyFor('internal_transfer_fee', null, on),
    policyFor('per_transfer_limit', null, on),
    ...unpublishedOn(on),
  ].filter((e): e is PolicyEntry => e !== null);
}

/**
 * The verified facts (plan Part 2 §4.A.5), numbered `F1…Fn`: every transfer of the case window (its
 * amount, reference, status and Madrid date), the salary a waiver reads, then the policy in force
 * for the customer's products whatever the claims, and the correct value of every contradicted
 * policy claim. Unverifiable claims contribute nothing. Returns the verdicts with `correctFactId`
 * pointing at the numbered facts.
 */
export function verifiedFacts(
  evidence: CaseEvidence,
  claims: Claim[],
  verdicts: ClaimVerdict[],
): { facts: VerifiedFact[]; verdicts: ClaimVerdict[] } {
  const subjects = subjectsOf(evidence).sort(
    (a, b) => subjectAt(a).localeCompare(subjectAt(b)) || subjectId(a).localeCompare(subjectId(b)),
  );
  const entries = casePolicyEntries(evidence);
  const contradictedPolicies = verdicts.flatMap((v) => {
    const claim = claims.find((c) => c.id === v.claimId);
    if (v.verdict !== 'contradicted' || claim?.kind !== 'policy_amount') return [];
    const lookup = policyEntryFor(claim, evidence);
    return 'entry' in lookup ? [lookup.entry] : [];
  });
  const policyDrafts = [...entries, ...contradictedPolicies].flatMap(policyFacts);
  // One policy fact per slot and value: a product entry is kept over the product-null one, and
  // the entry a contradicted claim was judged against is always kept.
  const seenPolicy = new Set<string>();
  const drafts = [
    ...subjects.flatMap((s) => subjectFacts(s, evidence)),
    ...waiverConditionFacts(entries, evidence),
    ...policyDrafts.filter(({ policy, value }) => {
      const id = `${policy!.slot}:${value}`;
      const keep = !seenPolicy.has(id) || contradictedPolicies.includes(policy!.entry);
      seenPolicy.add(id);
      return keep;
    }),
  ];
  const unique = drafts.filter((f, i) => drafts.findIndex((g) => g.key === f.key) === i);
  const ids = new Map(unique.map((f, i) => [f.key, `F${i + 1}`]));
  return {
    facts: unique.map(({ key, kind, value, statement, evidence }) => ({
      id: ids.get(key)!,
      kind,
      value,
      statement,
      evidence,
    })),
    verdicts: verdicts.map((v) =>
      v.verdict === 'contradicted'
        ? { ...v, correctFactId: ids.get(v.correctFactId) ?? v.correctFactId }
        : v,
    ),
  };
}
