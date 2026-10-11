import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { POLICY_RULES, policyFor, productOfAccount, type PolicyEntry } from './policy-rules';
import { referenceDate } from './reference-date';

const documentsDir = path.resolve(import.meta.dirname, '../../../fixtures/documents');
const documentOf = (entry: PolicyEntry) =>
  fs.readFileSync(path.join(documentsDir, `${entry.documentId}.md`), 'utf8');
const label = (entry: PolicyEntry) =>
  `${entry.documentId} ${entry.rule.kind} ${'product' in entry.rule ? entry.rule.product : ''}`;

const products = [
  'aurora',
  'horizon',
  'cloud',
  'family',
  'community',
  'professional',
  'young',
  'travel',
] as const;
/** The `## Terms and exceptions` section, where every policy sentence lives. */
const termsOf = (document: string) => {
  const start = document.indexOf('## Terms and exceptions');
  const end = document.indexOf('\n## ', start + 1);
  return start < 0 ? '' : document.slice(start, end < 0 ? undefined : end);
};
const occurrences = (text: string, quote: string) => text.split(quote).length - 1;

/** `EUR x` with `,` thousands separators and no trailing `.00`, not followed by more digits. */
const eur = (cents: number) => {
  const euros = (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `EUR ${euros.replaceAll('.', '\\.')}(?![\\d]|[.,]\\d)`;
};
const counts = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/**
 * Every value of a rule, bound to the phrase that states it, so a different number taken from the
 * same sentence (the waived EUR 0 or the EUR 1,200 salary for the Aurora fee) does not match.
 */
const valuesOf = (entry: PolicyEntry): RegExp[] => {
  const { rule } = entry;
  switch (rule.kind) {
    case 'monthly_fee':
      return [
        new RegExp(`monthly fee (for \\w+ )?is ${eur(rule.amountCents)}`),
        ...(rule.waiver
          ? [
              new RegExp(`waived \\(${eur(rule.waiver.waivedAmountCents)}\\)`),
              new RegExp(`salary payment of at least ${eur(rule.waiver.salaryCents)}`),
              new RegExp(
                `\\b(${rule.waiver.cardPurchases}|${counts[rule.waiver.cardPurchases]}) settled card purchases`,
              ),
            ]
          : []),
      ];
    case 'internal_transfer_fee':
      return [/have no fee|has a EUR 0(?![\d]|[.,]\d) fee/];
    case 'per_transfer_limit':
      return [new RegExp(`(limit per transfer is|up to) ${eur(rule.amountCents)}`)];
    case 'unpublished':
      return [new RegExp(`does not specify .*${rule.topic.replaceAll('_', ' ')}`)];
  }
};
const productOf = (entry: PolicyEntry) => ('product' in entry.rule ? entry.rule.product : null);
const keyOf = (entry: PolicyEntry) =>
  `${entry.rule.kind}/${entry.rule.kind === 'unpublished' ? entry.rule.topic : productOf(entry)}`;
const overlap = (a: PolicyEntry, b: PolicyEntry) =>
  (a.validTo === null || b.validFrom <= a.validTo) &&
  (b.validTo === null || a.validFrom <= b.validTo);

describe('POLICY_RULES drift guard', () => {
  it('should match the version and effective dates stated on line 3 of each document', () => {
    // Arrange
    const mismatched: string[] = [];
    // Act
    for (const entry of POLICY_RULES) {
      const line3 = documentOf(entry).split('\n')[2];
      const until =
        entry.validTo === null
          ? !line3.includes(' until ')
          : line3.includes(`until ${entry.validTo}`);
      const ok =
        line3.includes(`Version ${entry.version}.`) &&
        line3.includes(`Effective from ${entry.validFrom}`) &&
        until;
      if (!ok) mismatched.push(label(entry));
    }
    // Assert
    assert.deepEqual(mismatched, []);
  });

  it('should find every quote exactly once in the terms of its source document', () => {
    // Arrange
    const missing: string[] = [];
    // Act
    for (const entry of POLICY_RULES) {
      if (occurrences(termsOf(documentOf(entry)), entry.quote) !== 1) missing.push(label(entry));
    }
    // Assert
    assert.deepEqual(missing, []);
  });

  it('should state every value of a rule in its quote', () => {
    // Arrange
    const unstated: string[] = [];
    // Act
    for (const entry of POLICY_RULES) {
      for (const value of valuesOf(entry)) {
        if (!value.test(entry.quote)) unstated.push(`${label(entry)}: ${value}`);
      }
    }
    // Assert
    assert.deepEqual(unstated, []);
  });

  it('should hold one fee, one internal-transfer fee and one limit from each product document', () => {
    // Arrange
    const kinds = ['monthly_fee', 'internal_transfer_fee', 'per_transfer_limit'] as const;
    // Act
    const counted = products.flatMap((p) =>
      kinds.map(
        (kind) =>
          `${p}/${kind}=${
            POLICY_RULES.filter(
              (e) =>
                e.rule.kind === kind && productOf(e) === p && e.documentId === `${p}-fees-2026`,
            ).length
          }`,
      ),
    );
    // Assert
    assert.deepEqual(
      counted,
      products.flatMap((p) => kinds.map((kind) => `${p}/${kind}=1`)),
    );
  });

  it('should hold exactly the 29 entries of this release', () => {
    // Arrange
    // Act
    const size = POLICY_RULES.length;
    // Assert
    assert.equal(size, 29); // 8 fees + 8 internal + 8 limits + 2 FAQ + 3 unpublished
  });

  it('should keep the validity of entries for the same rule and product apart', () => {
    // Arrange
    const overlapping: string[] = [];
    // Act
    POLICY_RULES.forEach((a, i) =>
      POLICY_RULES.slice(i + 1).forEach((b) => {
        if (keyOf(a) === keyOf(b) && overlap(a, b)) overlapping.push(`${label(a)} / ${label(b)}`);
      }),
    );
    // Assert
    assert.deepEqual(overlapping, []);
  });

  it('should list referral rewards, mortgages and travel insurance as unpublished', () => {
    // Arrange
    // Act
    const topics = POLICY_RULES.flatMap((e) =>
      e.rule.kind === 'unpublished' ? [e.rule.topic] : [],
    );
    // Assert
    assert.deepEqual(topics.sort(), ['mortgage', 'referral_reward', 'travel_insurance']);
  });
});

describe('Aurora waiver documents kept out of POLICY_RULES', () => {
  it('should still state the EUR 6 fee, the EUR 0 waiver, the EUR 1,200 salary and three purchases', () => {
    // Arrange
    const files = ['notice-aurora.csv', 'faq-aurora-waiver.md'];
    const stated = [
      /EUR 6(?![\d]|[.,]\d)/,
      /EUR 0(?![\d]|[.,]\d)/,
      /EUR 1,200(?![\d]|[.,]\d)/,
      /\bthree\b/,
    ];
    // Act
    const missing = files.flatMap((file) => {
      const text = fs.readFileSync(path.join(documentsDir, file), 'utf8');
      return stated.filter((value) => !value.test(text)).map((value) => `${file}: ${value}`);
    });
    // Assert
    assert.deepEqual(missing, []);
  });

  it('should leave the notice and the FAQ out of the table', () => {
    // Arrange
    // Act
    const ids = POLICY_RULES.map((e) => e.documentId);
    // Assert
    assert.deepEqual(
      ids.filter((id) => id === 'notice-aurora' || id === 'faq-aurora-waiver'),
      [],
    );
  });
});

describe('policyFor', () => {
  it('should return the Aurora fee with its salary and card-purchase waiver', () => {
    // Arrange
    // Act
    const entry = policyFor('monthly_fee', 'aurora', referenceDate);
    // Assert
    assert.deepEqual(entry?.rule, {
      kind: 'monthly_fee',
      amountCents: 600,
      product: 'aurora',
      waiver: { waivedAmountCents: 0, salaryCents: 120000, cardPurchases: 3 },
    });
  });

  it('should prefer the product entry over the product-null one', () => {
    // Arrange
    // Act
    const entry = policyFor('per_transfer_limit', 'horizon', referenceDate);
    // Assert
    assert.equal(entry?.documentId, 'horizon-fees-2026');
  });

  it('should fall back to the product-null entry when the account has no product', () => {
    // Arrange
    // Act
    const entry = policyFor('internal_transfer_fee', null, referenceDate);
    // Assert
    assert.equal(entry?.documentId, 'faq-internal-transfer');
  });

  it('should return nothing before the current documents took effect', () => {
    // Arrange
    // Act
    const entry = policyFor('monthly_fee', 'aurora', '2026-08-31');
    // Assert
    assert.equal(entry, null);
  });

  it('should judge on the reference date when no date is given', () => {
    // Arrange
    // Act
    const entry = policyFor('monthly_fee', 'horizon');
    // Assert
    assert.deepEqual(entry, policyFor('monthly_fee', 'horizon', referenceDate));
  });
});

describe('productOfAccount', () => {
  it('should map an account label to its product', () => {
    // Arrange
    // Act
    const products = ['Aurora account', 'Horizon account'].map(productOfAccount);
    // Assert
    assert.deepEqual(products, ['aurora', 'horizon']);
  });

  it('should map a label whatever its case and surrounding spaces', () => {
    // Arrange
    // Act
    const product = productOfAccount('  AURORA Account ');
    // Assert
    assert.equal(product, 'aurora');
  });

  it('should map a savings account to no product', () => {
    // Arrange
    // Act
    const product = productOfAccount('Personal savings');
    // Assert
    assert.equal(product, null);
  });
});
