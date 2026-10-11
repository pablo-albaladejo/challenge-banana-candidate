import { unverifiable, type Claim } from '../../domain/claims';
import { verifyClaim } from '../../domain/claim-verification';
import { verifiedFacts } from '../../domain/verified-facts';
import { regexClaims } from '../../domain/regex-claims';
import { anchor, missedByModel } from '../../domain/anchoring';
import { findingsOf } from '../../domain/case-findings';
import { selectProcedures } from '../../domain/procedure-selection';
import { buildTimeline } from '../../domain/case-timeline';
import { templateReply } from '../../domain/template-reply';
import { checkDraft } from '../../domain/draft-check';
import { PROMPT_VERSION, type CaseBrief } from '../../domain/case-brief';
import type { CaseEvidence } from '../../domain/case-evidence';
import type { Clock } from '../../../shared/ports/clock';
import type { Ids } from '../../../shared/ports/ids';
import type { CaseFacts } from '../services/case-facts';
import type { ProcedureCatalog } from '../ports/procedure-catalog';
import type { CaseEvents } from '../ports/case-events';
import {
  ModelUnavailable,
  type CaseBriefModel,
  type DegradedReason,
} from '../ports/case-brief-model';

type Deps = {
  caseFacts: CaseFacts;
  procedures: ProcedureCatalog;
  caseEvents: CaseEvents;
  briefModel: CaseBriefModel;
  clock: Clock;
  ids: Ids;
};

const NOT_EXTRACTED =
  'Pattern matching found this value, but the model did not extract it as a claim.';

/**
 * Steps 3-4 (plan Part 2 §4.A.1) over a set of claims: the oracle judges every claim (a coverage
 * net claim is ⚪ `not_extracted`), then facts, findings and procedures follow from the verdicts.
 */
function judge(
  evidence: CaseEvidence,
  catalog: ReturnType<ProcedureCatalog['procedures']>,
  extracted: Claim[],
  net: Claim[] = [],
) {
  const claims = [...extracted, ...net];
  const { facts, verdicts } = verifiedFacts(evidence, claims, [
    ...extracted.map((c) => verifyClaim(c, evidence)),
    ...net.map((c) => unverifiable(c, 'not_extracted', NOT_EXTRACTED)),
  ]);
  const findings = findingsOf(evidence, claims, verdicts);
  const procedures = selectProcedures(findings, catalog, evidence.caseDate);
  return { claims, facts, verdicts, findings, procedures };
}

/**
 * The verified case brief (plan Part 2 §4.A.1). Evidence is gathered by code; the model extracts
 * the assistant's claims (anchored in their quotes, with the pattern-matching coverage net for
 * what it left out) and writes the prose from the verified facts only; the code oracle judges every
 * claim, and the post-check rewrites any value of the prose no fact backs. A draft reply the
 * post-check flags is replaced by the template reply (`draftFallback: 'post_check'`). If either
 * model step fails, the whole brief takes the deterministic path (`mode: 'degraded'`, with the
 * reason): pattern-matched claims, no prose, the template reply. Each generation is audited as
 * `case.brief_generated`.
 */
export const makeGenerateCaseBrief =
  ({ caseFacts, procedures, caseEvents, briefModel, clock, ids }: Deps) =>
  async ({ operatorId, incidentId }: { operatorId: string; incidentId: string }) => {
    const { evidence } = await caseFacts({ operatorId, incidentId });
    const catalog = procedures.procedures();
    const firstName = evidence.customer.name.split(' ')[0];
    const base: Pick<CaseBrief, 'incidentId' | 'generatedAt' | 'previousCases' | 'promptVersion'> =
      {
        incidentId: evidence.incident.id,
        generatedAt: clock.now().toISOString(),
        previousCases: evidence.previousCases.map(({ id, closed_at }) => ({
          id,
          closedAt: closed_at,
        })),
        promptVersion: PROMPT_VERSION,
      };
    const briefOf = (judged: ReturnType<typeof judge>) => ({
      ...base,
      timeline: buildTimeline(evidence, judged.claims, judged.verdicts, judged.findings),
      claims: judged.claims,
      verdicts: judged.verdicts,
      facts: judged.facts,
      findings: judged.findings,
      procedures: judged.procedures,
    });
    const template = (judged: ReturnType<typeof judge>) =>
      templateReply(firstName, judged.facts, judged.verdicts, judged.findings);

    let brief: CaseBrief;
    try {
      const rows = await briefModel.extractClaims({ messages: evidence.messages });
      const { claims, dropped } = anchor(rows, evidence.messages);
      const judged = judge(evidence, catalog, claims, missedByModel(evidence.messages, claims));
      const written = await briefModel.writeBrief({
        firstName,
        lastCustomerMessage:
          [...evidence.messages].reverse().find((m) => m.role === 'user')?.content ?? '',
        facts: judged.facts,
        claims: judged.claims,
        verdicts: judged.verdicts,
        findings: judged.findings,
        procedures: judged.procedures,
      });
      const { fields, flags } = checkDraft(
        { summary: written.summary, nextStep: written.nextStep, draftReply: written.draftReply },
        judged.facts,
        { substitute: true },
      );
      const factIds = new Set(judged.facts.map((f) => f.id));
      const usedFactIds = written.usedFactIds.filter((id) => factIds.has(id));
      const draftFails = flags.some((f) => f.field === 'draftReply');
      brief = {
        ...briefOf(judged),
        mode: 'full',
        degradedReason: null,
        dropped,
        prose: {
          summary: fields.summary!,
          nextStep: fields.nextStep!,
          draftReply: fields.draftReply!,
          usedFactIds,
          flags,
          unknownFactIds: written.usedFactIds.length - usedFactIds.length,
        },
        templateReply: draftFails ? template(judged) : null,
        draftFallback: draftFails ? 'post_check' : null,
      };
    } catch (error) {
      if (!(error instanceof ModelUnavailable)) throw error;
      const reason: DegradedReason = error.reason;
      const judged = judge(evidence, catalog, regexClaims(evidence.messages));
      brief = {
        ...briefOf(judged),
        mode: 'degraded',
        degradedReason: reason,
        dropped: 0,
        prose: null,
        templateReply: template(judged),
        draftFallback: null,
      };
    }
    caseEvents.briefGenerated({ id: ids.uuid(), operatorId, evidence, brief });
    return brief;
  };
