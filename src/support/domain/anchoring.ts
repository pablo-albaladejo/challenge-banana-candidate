import type { Product } from '../../shared/domain/policy-rules';
import { coverageNet } from './regex-claims';
import { scanAmounts, scanReferences, scanStatuses } from './scanners';
import type { Claim, ClaimStatus, PolicyKind } from './claims';

/** One row of the model's `case_claims` answer (plan Part 2 §4.A.6), before anchoring. */
export type ExtractedClaimRow = {
  messageId: string;
  quote: string;
  kind: 'amount' | 'reference' | 'operation_status' | 'policy_amount';
  amountCents: number | null;
  reference: string | null;
  status: ClaimStatus | null;
  policy: PolicyKind | null;
  product: Product | null;
};

type Message = { id: string; role: string; content: string };
/** A claim without its base fields, per kind. */
type ClaimBody = Claim extends infer C
  ? C extends Claim
    ? Omit<C, 'id' | 'messageId' | 'quote' | 'extractedBy'>
    : never
  : never;

/** The claim a row states once its values are anchored in its quote, or `null` to drop it. */
function bodyOf(row: ExtractedClaimRow): ClaimBody | null {
  const amountCents =
    row.amountCents !== null && scanAmounts(row.quote).some((a) => a.cents === row.amountCents)
      ? row.amountCents
      : null;
  const stated = row.reference?.toLowerCase();
  const reference = scanReferences(row.quote).some((r) => r.value === stated) ? stated! : null;
  switch (row.kind) {
    case 'amount':
      return amountCents === null ? null : { kind: 'amount', amountCents, reference };
    case 'reference':
      return reference === null ? null : { kind: 'reference', reference };
    case 'operation_status': {
      // The quote's own status words win: a model that reads "could not complete" as completed
      // is dropped, and the coverage net then shows the phrase as not extracted.
      const worded = scanStatuses(row.quote);
      if (row.status === null || (worded.length && !worded.some((s) => s.status === row.status)))
        return null;
      return { kind: 'operation_status', status: row.status, amountCents, reference };
    }
    case 'policy_amount':
      return amountCents === null || row.policy === null
        ? null
        : { kind: 'policy_amount', policy: row.policy, product: row.product, amountCents };
  }
}

/**
 * Anchoring (plan Part 2 §4.A.5) guards against an extractor that hallucinates. A row is dropped
 * when its quote is not a verbatim substring of one of this conversation's assistant messages, or
 * when its kind's value is missing once nulled; an amount or reference the quote does not state is
 * nulled. A status the quote words otherwise (by the scanners) is dropped too. Kept rows become
 * model claims `${messageId}#${n}`, to be judged by the oracle like any other.
 */
export function anchor(
  rows: ExtractedClaimRow[],
  messages: Message[],
): { claims: Claim[]; dropped: number } {
  const assistant = new Map(
    messages.filter((m) => m.role === 'assistant').map((m) => [m.id, m.content]),
  );
  const perMessage = new Map<string, number>();
  const claims: Claim[] = [];
  for (const row of rows) {
    const content = assistant.get(row.messageId);
    if (content === undefined || !row.quote.trim() || !content.includes(row.quote)) continue;
    const body = bodyOf(row);
    if (!body) continue;
    const n = perMessage.get(row.messageId) ?? 0;
    perMessage.set(row.messageId, n + 1);
    claims.push({
      ...body,
      id: `${row.messageId}#${n}`,
      messageId: row.messageId,
      quote: row.quote,
      extractedBy: 'model',
    } as Claim);
  }
  return { claims, dropped: rows.length - claims.length };
}

/**
 * The coverage net over the model's claims: what the scanners find that no model claim states,
 * to be judged ⚪ `not_extracted`. A policy amount the model extracted covers that amount of its
 * message (the scanners read it as a plain amount).
 */
export function missedByModel(messages: Message[], claims: Claim[]): Claim[] {
  const policyAmounts = new Set(
    claims.flatMap((c) => (c.kind === 'policy_amount' ? [`${c.messageId}:${c.amountCents}`] : [])),
  );
  return coverageNet(messages, claims).filter(
    (c) => !(c.kind === 'amount' && policyAmounts.has(`${c.messageId}:${c.amountCents}`)),
  );
}
