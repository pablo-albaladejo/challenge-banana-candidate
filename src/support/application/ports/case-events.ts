import type { CaseBrief } from '../../domain/case-brief';
import type { CaseEvidence } from '../../domain/case-evidence';
/** The audit trail of the support desk, in the case conversation's events. */
export type CaseEvents = {
  /**
   * Records `case.brief_generated`: counts, citations and an evidence hash, never customer text.
   * `id` is the event id.
   */
  briefGenerated(input: {
    id: string;
    operatorId: string;
    evidence: CaseEvidence;
    brief: CaseBrief;
  }): void;
};
