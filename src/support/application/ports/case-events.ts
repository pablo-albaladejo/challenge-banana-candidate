import type { CaseBrief } from '../../domain/case-brief';
import type { CaseEvidence } from '../../domain/case-evidence';
import type { DraftFlag } from '../../domain/draft-check';
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
  /**
   * Records `case.replied`: the case, the message id, whether unverified statements were
   * acknowledged, flag counts and the evidence hash of the recheck; never the reply's text.
   */
  replied(input: {
    id: string;
    operatorId: string;
    incidentId: string;
    messageId: string;
    evidence: CaseEvidence;
    flags: DraftFlag[];
    acknowledged: boolean;
    bankUnreachable: boolean;
    createdAt: string;
  }): void;
};
