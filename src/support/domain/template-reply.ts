import type { Finding } from './case-findings';
import type { ClaimVerdict, VerifiedFact } from './claims';

/**
 * The deterministic reply to the customer (plan Part 2 §4.A.8), built only from facts, verdicts
 * and findings: a correction per contradicted claim, in the fact's own words; the instruction not
 * to pay twice when the assistant advised a retry on a completed payment; and a holding line when
 * something could not be verified. It makes no promise.
 */
export function templateReply(
  firstName: string,
  facts: VerifiedFact[],
  verdicts: ClaimVerdict[],
  findings: Finding[],
): string {
  const corrections = [
    ...new Set(
      verdicts.flatMap((v) =>
        v.verdict === 'contradicted'
          ? (facts.find((f) => f.id === v.correctFactId)?.statement ?? [])
          : [],
      ),
    ),
  ];
  return [
    `Hello ${firstName}, thank you for your patience. A member of our support team has reviewed your case.`,
    ...corrections.map((statement) => `Correction: ${statement}`),
    ...(findings.some((f) => f.kind === 'retry_advice')
      ? ['Please do not send this payment again: it has already been completed.']
      : []),
    ...(verdicts.some((v) => v.verdict === 'unverifiable')
      ? ['We are still confirming some details and will update you here.']
      : []),
    'Banana Bank support',
  ].join('\n');
}
