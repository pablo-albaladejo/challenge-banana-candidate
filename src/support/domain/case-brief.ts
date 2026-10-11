import type { Claim, ClaimVerdict, VerifiedFact } from './claims';
import type { DraftFlag } from './draft-check';
import type { Finding } from './case-findings';
import type { ProcedureRef } from './procedure-selection';
import type { TimelineEntry } from './case-timeline';

export type { DraftFlag };
/** What the one writing call returns (plan Part 2 §4.A.6), before the post-check. */
export type BriefProse = {
  summary: string;
  nextStep: string;
  draftReply: string;
  usedFactIds: string[];
};
export const PROMPT_VERSION = 'brief-v2';

/**
 * The verified case brief (plan Part 2 §4.A.7). `full`: the model extracted the claims (anchored,
 * plus the coverage net) and wrote the prose, which the post-check has passed or rewritten; the
 * code oracle judged every claim either way. `degraded`: a model step failed (`degradedReason`),
 * so claims come from pattern matching, there is no prose, and the template reply is the draft.
 * `templateReply` is set whenever the template is the draft to send: always when degraded, and in
 * full mode when the model's `draftReply` failed the post-check (`draftFallback: 'post_check'`).
 */
export type CaseBrief = {
  incidentId: string;
  /** From the Clock. */
  generatedAt: string;
  mode: 'full' | 'degraded';
  degradedReason: 'missing_key' | 'model_error' | 'invalid_output' | null;
  timeline: TimelineEntry[];
  claims: Claim[];
  verdicts: ClaimVerdict[];
  /** Model rows dropped by anchoring. */
  dropped: number;
  facts: VerifiedFact[];
  findings: Finding[];
  procedures: ProcedureRef[];
  previousCases: { id: string; closedAt: string | null }[];
  /** `unknownFactIds`: the cited fact ids that do not exist, dropped from `usedFactIds`. */
  prose: (BriefProse & { flags: DraftFlag[]; unknownFactIds: number }) | null;
  templateReply: string | null;
  /** Why the template replaced the model's draft in full mode; `null` otherwise. */
  draftFallback: 'post_check' | null;
  promptVersion: typeof PROMPT_VERSION;
};
