import { scanAmounts, scanCommitments, scanReferences, scanStatuses } from './scanners';
import type { VerifiedFact } from './claims';

export type DraftField = 'summary' | 'nextStep' | 'draftReply';
/** A value or a promise in a draft that no verified fact backs. Offsets are in the returned text. */
export type DraftFlag = {
  field: DraftField;
  start: number;
  end: number;
  found: string;
  kind: 'amount' | 'reference' | 'status' | 'ambiguous_status' | 'commitment';
  substituted: boolean;
};

type Match = {
  start: number;
  end: number;
  found: string;
  kind: DraftFlag['kind'];
  replace: boolean;
};

/** Every amount a fact states, in cents: amount facts and the policy facts that are amounts. */
const factCents = (facts: VerifiedFact[]) =>
  new Set(
    facts
      .filter((f) => f.kind === 'amount' || f.kind === 'policy')
      .flatMap((f) => scanAmounts(f.value).map((a) => a.cents)),
  );

/**
 * The post-check (plan Part 2 §4.A.7). Every amount, reference and status in the fields must be a
 * verified fact of the same kind; in `draftReply` every promise (refund, reversal, waiver, retry,
 * deadline) is flagged, unless it lies inside a verbatim copy of a fact statement. With
 * `substitute`, an untraced value in `draftReply` becomes `[check: amount|reference|status]`;
 * a commitment or an ambiguous status is only flagged, and the other fields are never rewritten.
 * Without it (the send-time recheck) nothing is rewritten: the scanners only report.
 */
export function checkDraft(
  fields: Partial<Record<DraftField, string>>,
  facts: VerifiedFact[],
  { substitute }: { substitute: boolean },
): { fields: Partial<Record<DraftField, string>>; flags: DraftFlag[] } {
  const cents = factCents(facts);
  const references = new Set(facts.filter((f) => f.kind === 'reference').map((f) => f.value));
  const statuses = new Set(facts.filter((f) => f.kind === 'status').map((f) => f.value));
  const statements = facts.map((f) => f.statement);
  const flags: DraftFlag[] = [];
  const checked: Partial<Record<DraftField, string>> = {};
  for (const [field, text] of Object.entries(fields) as [DraftField, string][]) {
    const replace = substitute && field === 'draftReply';
    const matches: Match[] = [
      ...scanAmounts(text)
        .filter((a) => !cents.has(a.cents))
        .map((a) => ({ ...a, kind: 'amount' as const, replace })),
      ...scanReferences(text)
        .filter((r) => !references.has(r.value))
        .map((r) => ({ ...r, kind: 'reference' as const, replace })),
      ...scanStatuses(text)
        .filter((s) => s.status === 'ambiguous_status' || !statuses.has(s.status))
        .map((s) =>
          s.status === 'ambiguous_status'
            ? { ...s, kind: 'ambiguous_status' as const, replace: false }
            : { ...s, kind: 'status' as const, replace },
        ),
      ...(field === 'draftReply'
        ? scanCommitments(text, statements).map((c) => ({
            ...c,
            kind: 'commitment' as const,
            replace: false,
          }))
        : []),
    ].sort((a, b) => a.start - b.start || b.end - a.end);
    let out = '';
    let cursor = 0;
    let last = { start: 0, end: 0 };
    for (const m of matches) {
      if (m.start < cursor) {
        // Inside a span already written: flagged at that span, never rewritten twice.
        flags.push({ field, ...last, found: m.found, kind: m.kind, substituted: false });
        continue;
      }
      out += text.slice(cursor, m.start);
      const written = m.replace ? `[check: ${m.kind}]` : m.found;
      last = { start: out.length, end: out.length + written.length };
      out += written;
      flags.push({ field, ...last, found: m.found, kind: m.kind, substituted: m.replace });
      cursor = m.end;
    }
    checked[field] = out + text.slice(cursor);
  }
  return { fields: checked, flags };
}
