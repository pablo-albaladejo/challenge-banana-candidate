/**
 * The pattern scanners shared by the regex claim extractor, the coverage net and the draft check
 * (plan Part 2 §4.A.5). Case-insensitive; each returns spans of the text it read, in text order.
 */
export type Span = { start: number; end: number; found: string };
export type ClaimStatus = 'completed' | 'not_completed' | 'pending';
/**
 * A status phrase under a negation, or one that states no settled outcome ("has not been sent" is
 * true of a pending transfer as much as of a failed one): it states no status the brief can judge.
 */
export type ScannedStatus = ClaimStatus | 'ambiguous_status';

const thousands = '[., \\u00a0\\u202f]';
/** A number with thousands groups, or a plain one; a final 1-2 digit group is decimal. */
const NUMBER = `(?:\\d{1,3}(?:${thousands}\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)(?!\\d)`;
const gap = '[\\s\\u00a0\\u202f]*';
const AMOUNT = new RegExp(
  `(?:\\bEUR${gap}|€${gap})(?<![\\d.,])(${NUMBER})|(?<![\\d.,])(${NUMBER})${gap}(?:EUR\\b|€|euros?\\b)`,
  'gi',
);

/** `1.200,50` → 120050: the separator before a final 1-2 digit group is decimal, any other groups thousands. */
function centsOf(number: string) {
  const decimal = number.match(/[.,](\d{1,2})$/);
  const whole = (decimal ? number.slice(0, -decimal[0].length) : number).replace(/\D/g, '');
  return Number(whole) * 100 + (decimal ? Number(decimal[1].padEnd(2, '0')) : 0);
}

/** Every euro amount (`EUR 85`, `85 EUR`, `€85`, `85 €`, `85 euros`), normalised to cents. */
export function scanAmounts(text: string): (Span & { cents: number })[] {
  return [...text.matchAll(AMOUNT)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    found: m[0],
    cents: centsOf(m[1] ?? m[2]),
  }));
}

/** Every bank reference or operation id (`ref-…`, `op-…`), lower-cased. */
export function scanReferences(text: string): (Span & { value: string })[] {
  return [...text.matchAll(/\b(?:ref|op)-[a-z0-9-]*[a-z0-9]\b/gi)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    found: m[0],
    value: m[0].toLowerCase(),
  }));
}

const STATUS_PHRASES: Record<ScannedStatus, string[]> = {
  not_completed: [
    'could not be completed',
    'was not completed',
    "wasn't completed",
    'could not complete',
    "couldn't complete",
    'did not complete',
    "didn't complete",
    'did not go through',
    "didn't go through",
    'was not sent',
    "wasn't sent",
    'failed',
    'was rejected',
  ],
  pending: [
    'is still being verified',
    'being verified',
    'is still processing',
    'is pending',
    'pending',
  ],
  completed: [
    'has been completed',
    'was completed',
    'transfer completed',
    'has been sent',
    'went through',
    'was sent',
    'completed',
  ],
  // No settled outcome: each is as true of a transfer still pending as of one that failed, and a
  // denied rejection states no status at all.
  ambiguous_status: [
    'has not been completed',
    "hasn't been completed",
    'has not been sent',
    "hasn't been sent",
    'not completed',
    'was not rejected',
    "wasn't rejected",
  ],
};
const escape = (phrase: string) =>
  phrase
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll("'", "['’]")
    .replaceAll(' ', '\\s+');
const phraseStatus = Object.entries(STATUS_PHRASES).flatMap(([status, phrases]) =>
  phrases.map((phrase) => ({ phrase, status: status as ScannedStatus })),
);
// Longest first, so at any position the longest phrase wins; matching is leftmost and consumes the span.
const STATUS = new RegExp(
  `\\b(?:${[...phraseStatus]
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .map((p) => escape(p.phrase))
    .join('|')})\\b`,
  'gi',
);
const statusOf = (found: string) => {
  const normalised = found.toLowerCase().replace(/\s+/g, ' ').replaceAll('’', "'");
  return phraseStatus.find((p) => p.phrase === normalised)!.status;
};
/** The last `count` words before `index`, lower-cased, with curly apostrophes made straight. */
const wordsBefore = (text: string, index: number, count: number) =>
  text
    .slice(0, index)
    .toLowerCase()
    .replaceAll('’', "'")
    .split(/\s+/)
    .filter(Boolean)
    .slice(-count)
    .map((w) => w.replace(/[^\w']/g, ''));

/**
 * Every status phrase. Any phrase with `not`, `never` or `n't` among the three words before it is
 * `ambiguous_status`: "has not failed" is never read as not completed, "is not pending" never as
 * pending, "not yet completed" never as completed. The negation inside a phrase ("was not sent")
 * is part of the phrase, not a word before it. The present-tense negatives ("has not been sent",
 * "is not completed") and a denied rejection are `ambiguous_status` phrases of their own.
 */
export function scanStatuses(text: string): (Span & { status: ScannedStatus })[] {
  return [...text.matchAll(STATUS)].map((m) => {
    const status = statusOf(m[0]);
    const negated = wordsBefore(text, m.index, 3).some(
      (w) => w === 'not' || w === 'never' || w.endsWith("n't"),
    );
    return {
      start: m.index,
      end: m.index + m[0].length,
      found: m[0],
      status: negated ? 'ambiguous_status' : status,
    };
  });
}

const COMMITMENTS: { pattern: RegExp; retry: boolean }[] = [
  { pattern: /\brefund(?:s|ed|ing)?\b/gi, retry: false },
  { pattern: /\breimburs(?:e|ed|ement|ing)\b/gi, retry: false },
  { pattern: /\bcompensat(?:e|ed|ion|ing)\b/gi, retry: false },
  { pattern: /\bguarantee(?:s|d)?\b/gi, retry: false },
  { pattern: /\brevers(?:e|ed|al|ing)\b/gi, retry: false },
  {
    pattern: /\b(?:will|we['’]ll|we will|can|could|shall|going to)\s+(?:\w+\s+){0,2}waived?\b/gi,
    retry: false,
  },
  { pattern: /\btry\s+(?:it\s+)?again\b/gi, retry: true },
  { pattern: /\bretry(?:ing)?\b/gi, retry: true },
  { pattern: /\bresend\b/gi, retry: true },
  { pattern: /\brepeat\s+(?:the|this)\s+(?:transfer|payment)\b/gi, retry: false },
  {
    pattern:
      /\b(?:send|sending)\s+(?:it\s+|this\s+payment\s+|this\s+|the\s+transfer\s+|the\s+payment\s+)?again\b/gi,
    retry: true,
  },
  { pattern: /\bwithin\s+\d+\s+(?:business\s+|working\s+)?(?:days?|hours?)\b/gi, retry: false },
];
const NEGATION = /(?:^|\s)(?:do not|don't|never|no need to)(?:\s|$)/;

/**
 * Every promise support may not make (refund, reversal, waiver, retry, deadline). A match is
 * exempt after `do not`, `don't`, `never`, `no need to` or `please do not` within the four words
 * before it, or inside a verbatim copy of one of `statements` (a fact quoted, not a promise).
 * `retry` marks the phrases that tell the customer to send the payment again.
 */
export function scanCommitments(text: string, statements: string[]): (Span & { retry: boolean })[] {
  const quoted: [number, number][] = statements.flatMap((s) => {
    const spans: [number, number][] = [];
    for (let at = s ? text.indexOf(s) : -1; at !== -1; at = text.indexOf(s, at + 1))
      spans.push([at, at + s.length]);
    return spans;
  });
  return COMMITMENTS.flatMap(({ pattern, retry }) =>
    [...text.matchAll(pattern)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      found: m[0],
      retry,
    })),
  )
    .filter((c) => !NEGATION.test(` ${wordsBefore(text, c.start, 4).join(' ')} `))
    .filter((c) => !quoted.some(([start, end]) => start <= c.start && c.end <= end))
    .sort((a, b) => a.start - b.start);
}
