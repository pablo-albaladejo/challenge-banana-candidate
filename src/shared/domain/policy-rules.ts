import { referenceDate } from './reference-date';

export type Product =
  'aurora' | 'horizon' | 'cloud' | 'family' | 'community' | 'professional' | 'young' | 'travel';

/** The Aurora waiver: the fee drops to EUR 0 with a salary of EUR 1,200 and 3 card purchases. */
export type Waiver = { waivedAmountCents: 0; salaryCents: 120000; cardPurchases: 3 };

export type PolicyRule =
  | { kind: 'monthly_fee'; amountCents: number; product: Product; waiver: Waiver | null }
  | { kind: 'internal_transfer_fee'; amountCents: 0; product: Product | null } // null = any product
  | { kind: 'per_transfer_limit'; amountCents: number; product: Product | null }
  | { kind: 'unpublished'; topic: 'referral_reward' | 'mortgage' | 'travel_insurance' };

export type PolicyEntry = {
  documentId: string;
  version: number;
  validFrom: string;
  validTo: string | null;
  /** The exact sentence of the document that states the rule; the drift guard looks for it. */
  quote: string;
  rule: PolicyRule;
};

const products: readonly Product[] = [
  'aurora',
  'horizon',
  'cloud',
  'family',
  'community',
  'professional',
  'young',
  'travel',
];
const current = { version: 2, validFrom: '2026-09-01', validTo: null };
const monthlyFee = (product: Product, amountCents: number, quote: string): PolicyEntry => ({
  documentId: `${product}-fees-2026`,
  ...current,
  quote,
  rule: { kind: 'monthly_fee', amountCents, product, waiver: null },
});
const unpublishedQuote =
  'The documentation does not specify referral rewards, mortgages, or travel insurance.';

/**
 * The policy values in force, each tied to the sentence that states it (guarded against drift by
 * `policy-rules.test.ts`). The archived Aurora EUR 8 fee (`archive-aurora-1`, until 2026-08-31) is
 * left out on purpose: it is in force on no date a case is judged on.
 */
export const POLICY_RULES: readonly PolicyEntry[] = [
  {
    documentId: 'aurora-fees-2026',
    ...current,
    quote:
      'The Aurora account monthly fee is EUR 6. It is fully waived (EUR 0) only when BOTH requirements are met in the same month: a salary payment of at least EUR 1,200 and three settled card purchases.',
    rule: {
      kind: 'monthly_fee',
      amountCents: 600,
      product: 'aurora',
      waiver: { waivedAmountCents: 0, salaryCents: 120000, cardPurchases: 3 },
    },
  },
  monthlyFee('horizon', 300, 'The monthly fee for Horizon is EUR 3.'),
  monthlyFee('cloud', 0, 'The monthly fee for Cloud is EUR 0.'),
  monthlyFee('family', 500, 'The monthly fee for Family is EUR 5.'),
  monthlyFee('community', 200, 'The monthly fee for Community is EUR 2.'),
  monthlyFee('professional', 900, 'The monthly fee for Professional is EUR 9.'),
  monthlyFee('young', 0, 'The monthly fee for Young is EUR 0.'),
  monthlyFee('travel', 400, 'The monthly fee for Travel is EUR 4.'),
  ...products.map((product): PolicyEntry => ({
    documentId: `${product}-fees-2026`,
    ...current,
    quote: 'Standard internal transfers between simulator accounts have no fee.',
    rule: { kind: 'internal_transfer_fee', amountCents: 0, product },
  })),
  ...products.map((product): PolicyEntry => ({
    documentId: `${product}-fees-2026`,
    ...current,
    quote: 'The limit per transfer is EUR 100,000.',
    rule: { kind: 'per_transfer_limit', amountCents: 10_000_000, product },
  })),
  {
    documentId: 'faq-internal-transfer',
    ...current,
    quote: 'A standard internal transfer has a EUR 0 fee.',
    rule: { kind: 'internal_transfer_fee', amountCents: 0, product: null },
  },
  {
    documentId: 'faq-limits',
    ...current,
    quote: 'A transfer can be up to EUR 100,000',
    rule: { kind: 'per_transfer_limit', amountCents: 10_000_000, product: null },
  },
  ...(['referral_reward', 'mortgage', 'travel_insurance'] as const).map((topic): PolicyEntry => ({
    documentId: 'context-guide-1',
    ...current,
    quote: unpublishedQuote,
    rule: { kind: 'unpublished', topic },
  })),
];

/** Whether `entry` is in force on `onDate` (ISO date): the rule `policyFor` applies to every entry. */
export const inForce = (entry: PolicyEntry, onDate: string) =>
  entry.validFrom <= onDate && (entry.validTo === null || onDate <= entry.validTo);

/**
 * The entry of `kind` in force on `onDate` (ISO date, default the document reference date); a
 * product-specific entry beats a product-null one. Unpublished topics are looked up in
 * `POLICY_RULES` directly.
 */
export const policyFor = (
  kind: Exclude<PolicyRule['kind'], 'unpublished'>,
  product: Product | null,
  onDate: string = referenceDate,
): PolicyEntry | null => {
  const candidates = POLICY_RULES.filter(
    (e) => e.rule.kind === kind && inForce(e, onDate) && 'product' in e.rule,
  );
  const productOf = (e: PolicyEntry) => ('product' in e.rule ? e.rule.product : null);
  return (
    (product && candidates.find((e) => productOf(e) === product)) ||
    candidates.find((e) => productOf(e) === null) ||
    null
  );
};

/** `'Aurora account'` → `aurora` (case and outer spaces ignored); any other label → `null`. */
export const productOfAccount = (label: string): Product | null => {
  const normalised = label.trim().toLowerCase();
  return products.find((p) => normalised === `${p} account`) ?? null;
};
