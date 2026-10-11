import type { ExtractedClaimRow } from '../../domain/anchoring';
import type { BriefProse } from '../../domain/case-brief';
import type { Claim, ClaimVerdict, VerifiedFact } from '../../domain/claims';
import type { Finding } from '../../domain/case-findings';
import type { ProcedureRef } from '../../domain/procedure-selection';

/** Why the model steps of a brief could not run: the brief then takes the deterministic path. */
export type DegradedReason = 'missing_key' | 'model_error' | 'invalid_output';

/** Thrown by a `CaseBriefModel` for any failure: no key, a provider error or timeout, bad output. */
export class ModelUnavailable extends Error {
  constructor(readonly reason: DegradedReason) {
    super(`Case brief model unavailable: ${reason}.`);
    this.name = 'ModelUnavailable';
  }
}

/** Everything the writing call may see: code-built material, plus the customer's own words. */
export type WriteBriefInput = {
  firstName: string;
  lastCustomerMessage: string;
  facts: VerifiedFact[];
  claims: Claim[];
  verdicts: ClaimVerdict[];
  findings: Finding[];
  procedures: ProcedureRef[];
};

/**
 * The two model steps of the brief (plan Part 2 §4.A.1 steps 3 and 5): one structured call each,
 * no tools, no loop. The model extracts and writes; it never judges. Both reject with
 * `ModelUnavailable` only.
 */
export type CaseBriefModel = {
  extractClaims(input: {
    messages: { id: string; role: string; content: string }[];
  }): Promise<ExtractedClaimRow[]>;
  writeBrief(input: WriteBriefInput): Promise<BriefProse>;
};
