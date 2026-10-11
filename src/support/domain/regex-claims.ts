import { scanAmounts, scanReferences, scanStatuses, type Span } from './scanners';
import type { Claim, UnjudgedReason } from './claims';

type Message = { id: string; role: string; content: string };
type Found = {
  start: number;
  end: number;
  claim: Omit<Claim, 'id' | 'messageId' | 'quote' | 'extractedBy'>;
};

/** The sentence of `text` around a span, trimmed: what the UI quotes for a pattern-matched claim. */
export function sentenceAround(text: string, start: number, end: number) {
  const before = text.slice(0, start).search(/[.!?]\s+[^.!?]*$/);
  const from = before === -1 ? 0 : before + 1;
  const stop = text.slice(end).search(/[.!?](\s|$)/);
  const to = stop === -1 ? text.length : end + stop + 1;
  return text.slice(from, to).trim();
}

/**
 * Where one clause ends and the next begins: a sentence end, or `,` `;` `:` before a space (never
 * inside `1,200.50`), a spaced dash, or a joining word (and, but, or, while, whereas, although,
 * though, because, however, unless).
 */
const CLAUSE_BREAK =
  /[.!?,;:](?=\s|$)|\s[-–—]\s|\s(?:and|but|or|while|whereas|although|though|because|however|unless)\s/gi;
type Clause = { start: number; end: number; question: boolean };

/** The clause of `text` around a span, and whether the sentence it ends asks a question. */
function clauseAround(text: string, start: number, end: number): Clause {
  let from = 0;
  let to = text.length;
  for (const b of text.matchAll(CLAUSE_BREAK)) {
    if (b.index + b[0].length <= start) from = b.index + b[0].length;
    else if (b.index >= end) {
      to = b.index;
      break;
    }
  }
  return { start: from, end: to, question: text.slice(end).match(/[.!?](?=\s|$)/)?.[0] === '?' };
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replaceAll('’', "'")
    .split(/[^\w']+/)
    .filter(Boolean);
const NEGATIONS = new Set(['not', 'never', 'no', 'nor', 'neither', 'cannot']);
const negation = (w: string) => NEGATIONS.has(w) || w.endsWith("n't");
const HEDGES = new Set(
  (
    'will would could might may must shall should going once when whenever if whether until ' +
    'unless after before expect expects expected likely probably possibly perhaps maybe ' +
    'hopefully soon think believe seems appears unsure uncertain'
  ).split(' '),
);
const hedge = (w: string) => HEDGES.has(w) || w.endsWith("'ll") || w.endsWith("'d");
/** A word that names a transfer; a pronoun ("it") never does, whatever it may refer to. */
const TRANSFER_WORD = /\b(?:transfers?|payments?|money|operations?|transactions?)\b/i;
/** "pending your confirmation": waiting on the customer, not a status of the transfer. */
const AWAITING_CUSTOMER = /^\s+(?:on\s+)?(?:your\s+|the\s+)?(?:confirmation|approval)\b/i;

const within = <T extends Span>(spans: T[], c: Clause) =>
  spans.filter((s) => s.start >= c.start && s.end <= c.end);
/** The one value of a clause, `null` when it has none; several make the subject ambiguous. */
const single = <T>(values: T[]) => (values.length === 1 ? values[0] : null);

/**
 * Every amount, reference and status phrase the scanners find in one assistant message, each with
 * whether the oracle may judge it (plan Part 2 §4.A.5: conservative by default). A status phrase is
 * judgeable only in a declarative clause that names a transfer (a transfer word or a reference),
 * with no hedge before the phrase and no negation outside it; otherwise it is `ambiguous_status`
 * (hedged, negated, asked, or "pending your confirmation") or about no transfer. An amount is
 * judgeable only in a clause that has a judgeable status phrase, or a reference beside a transfer
 * word. A status or amount claim carries the single amount and reference of its own clause.
 */
function scan(message: Message): Found[] {
  const text = message.content;
  const amounts = scanAmounts(text);
  const references = scanReferences(text);
  const statuses = scanStatuses(text).map((s) => {
    const clause = clauseAround(text, s.start, s.end);
    const before = words(text.slice(clause.start, s.start));
    const outside = [...before, ...words(text.slice(s.end, clause.end))];
    const hedged =
      clause.question ||
      before.some(hedge) ||
      outside.some(negation) ||
      (s.status === 'pending' && AWAITING_CUSTOMER.test(text.slice(s.end)));
    const status = hedged ? ('ambiguous_status' as const) : s.status;
    const aboutTransfer =
      TRANSFER_WORD.test(text.slice(clause.start, clause.end)) ||
      within(references, clause).length > 0;
    return { ...s, clause, status, judgeable: status !== 'ambiguous_status' && aboutTransfer };
  });
  /** Why a claim of `clause` may not be judged once its own shape holds, or `null`. */
  const subjectOf = (
    clause: Clause,
  ): { unjudged: UnjudgedReason | null; reference: string | null } => {
    const refs = within(references, clause);
    return {
      unjudged: refs.length > 1 ? 'ambiguous_subject' : null,
      reference: single(refs)?.value ?? null,
    };
  };
  return [
    ...amounts.map((a) => {
      const clause = clauseAround(text, a.start, a.end);
      const anchored =
        statuses.some((s) => s.judgeable && s.clause.start === clause.start) ||
        (within(references, clause).length > 0 &&
          TRANSFER_WORD.test(text.slice(clause.start, clause.end)));
      const { unjudged, reference } = subjectOf(clause);
      return {
        start: a.start,
        end: a.end,
        claim: {
          kind: 'amount' as const,
          amountCents: a.cents,
          reference,
          unjudged: anchored ? unjudged : ('unanchored_amount' as const),
        },
      };
    }),
    ...references.map((r) => ({
      start: r.start,
      end: r.end,
      claim: { kind: 'reference' as const, reference: r.value, unjudged: null },
    })),
    ...statuses.map((s) => {
      const { unjudged, reference } = subjectOf(s.clause);
      const clauseAmounts = within(amounts, s.clause);
      return {
        start: s.start,
        end: s.end,
        claim: {
          kind: 'operation_status' as const,
          status: s.status,
          amountCents: single(clauseAmounts)?.cents ?? null,
          reference,
          unjudged:
            s.status === 'ambiguous_status'
              ? ('ambiguous_status' as const)
              : !s.judgeable
                ? ('no_subject_found' as const)
                : clauseAmounts.length > 1
                  ? ('ambiguous_subject' as const)
                  : unjudged,
        },
      };
    }),
  ].sort((a, b) => a.start - b.start);
}

const toClaims = (message: Message, found: Found[]): Claim[] =>
  found.map(
    (f, index) =>
      ({
        ...f.claim,
        id: `${message.id}#${index}`,
        messageId: message.id,
        quote: sentenceAround(message.content, f.start, f.end),
        extractedBy: 'regex',
      }) as Claim,
  );

/**
 * The claims pattern matching finds in the assistant's messages, for the deterministic brief: one
 * per amount, per reference, and per status phrase, each marked `unjudged` unless its clause has
 * the whitelisted shape (see `scan`). A negated or hedged status phrase is still a claim,
 * `ambiguous_status`, so the brief shows it as ⚪ instead of finding nothing. No policy claims: a
 * pattern cannot tell a fee from a transfer amount.
 */
export function regexClaims(messages: Message[]): Claim[] {
  return messages.filter((m) => m.role === 'assistant').flatMap((m) => toClaims(m, scan(m)));
}

/** The normalised value a claim states, so two claims of one message can be compared. */
const valueOf = (c: Pick<Claim, 'kind'> & Partial<Record<string, unknown>>) =>
  c.kind === 'amount'
    ? `amount:${c.amountCents}`
    : c.kind === 'reference'
      ? `reference:${c.reference}`
      : c.kind === 'operation_status'
        ? `status:${c.status}`
        : null;

/**
 * The coverage net: every amount, reference and status phrase of an assistant message that no
 * extracted claim of the same message covers (same normalised value or status), as a regex claim.
 * The caller judges each as unverifiable `not_extracted`, so a claim the extractor omitted stays
 * visible instead of silently absent.
 */
export function coverageNet(messages: Message[], claims: Claim[]): Claim[] {
  return messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => {
      const covered = new Set(claims.filter((c) => c.messageId === m.id).map(valueOf));
      const missed = scan(m).filter((f) => !covered.has(valueOf(f.claim)));
      return toClaims(m, missed).map((c, i) => ({ ...c, id: `${m.id}#net-${i}` }));
    });
}
