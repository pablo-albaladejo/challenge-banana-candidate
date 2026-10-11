import type { Claim, ClaimVerdict, VerifiedFact } from './claims';
import type { DraftFlag } from './draft-check';
import type { Finding } from './case-findings';
import type { ProcedureRef } from './procedure-selection';
import type { TimelineEntry } from './case-timeline';

export type { DraftFlag };
/** What the one model call writes (lands with the model-written brief). */
export type BriefProse = {
  summary: string;
  nextStep: string;
  draftReply: string;
  usedFactIds: string[];
};
export const PROMPT_VERSION = 'brief-v2';

/**
 * The verified case brief (plan Part 2 §4.A.7). Until the model-written brief lands, every brief
 * takes the deterministic path: `mode: 'degraded'` with `degradedReason: null` (no model step was
 * attempted), pattern-matched claims, no prose, and the template reply.
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
  prose: (BriefProse & { flags: DraftFlag[] }) | null;
  templateReply: string | null;
  promptVersion: typeof PROMPT_VERSION;
};
