import { verifyClaim } from '../../domain/claim-verification';
import { verifiedFacts } from '../../domain/verified-facts';
import { regexClaims } from '../../domain/regex-claims';
import { findingsOf } from '../../domain/case-findings';
import { selectProcedures } from '../../domain/procedure-selection';
import { buildTimeline } from '../../domain/case-timeline';
import { templateReply } from '../../domain/template-reply';
import { PROMPT_VERSION, type CaseBrief } from '../../domain/case-brief';
import type { Clock } from '../../../shared/ports/clock';
import type { Ids } from '../../../shared/ports/ids';
import type { CaseFacts } from '../services/case-facts';
import type { ProcedureCatalog } from '../ports/procedure-catalog';
import type { CaseEvents } from '../ports/case-events';

type Deps = {
  caseFacts: CaseFacts;
  procedures: ProcedureCatalog;
  caseEvents: CaseEvents;
  clock: Clock;
  ids: Ids;
};

/**
 * The verified case brief (plan Part 2 §4.A.1), on its deterministic path: every claim is found by
 * pattern matching and judged by code against the evidence and the policy rules; facts, findings,
 * procedures and the template reply follow from them. No model is called. Each generation is
 * audited as `case.brief_generated`.
 */
export const makeGenerateCaseBrief =
  ({ caseFacts, procedures, caseEvents, clock, ids }: Deps) =>
  async ({ operatorId, incidentId }: { operatorId: string; incidentId: string }) => {
    const { evidence } = await caseFacts({ operatorId, incidentId });
    const claims = regexClaims(evidence.messages);
    const { facts, verdicts } = verifiedFacts(
      evidence,
      claims,
      claims.map((c) => verifyClaim(c, evidence)),
    );
    const findings = findingsOf(evidence, claims, verdicts);
    const brief: CaseBrief = {
      incidentId: evidence.incident.id,
      generatedAt: clock.now().toISOString(),
      mode: 'degraded',
      degradedReason: null,
      timeline: buildTimeline(evidence, claims, verdicts, findings),
      claims,
      verdicts,
      dropped: 0,
      facts,
      findings,
      procedures: selectProcedures(findings, procedures.procedures(), evidence.caseDate),
      previousCases: evidence.previousCases.map(({ id, closed_at }) => ({
        id,
        closedAt: closed_at,
      })),
      prose: null,
      templateReply: templateReply(evidence.customer.name.split(' ')[0], facts, verdicts, findings),
      promptVersion: PROMPT_VERSION,
    };
    caseEvents.briefGenerated({ id: ids.uuid(), operatorId, evidence, brief });
    return brief;
  };
