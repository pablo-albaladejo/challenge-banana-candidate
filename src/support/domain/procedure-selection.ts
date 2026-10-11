import type { Finding } from './case-findings';

/** An internal procedure that applies to a case, cited as the assistant cites documents. */
export type ProcedureRef = {
  documentId: string;
  /** `null` when no version is in force on the case date. */
  version: number | null;
  title: string;
  /** `[procedure-3 v2]`, or `[procedure-3 — no version in force]`. */
  citation: string;
  because: Finding['kind'] | 'default';
};

/** The procedures each finding calls for, in order (plan Part 2 §4.A.6). */
export const PROCEDURES_BY_FINDING: Record<Finding['kind'] | 'default', string[]> = {
  unlinked_operation: ['procedure-1', 'procedure-7'],
  retry_advice: ['procedure-3', 'procedure-8'],
  false_status_claim: ['procedure-3', 'procedure-10'],
  unsettled_intent: ['procedure-3', 'procedure-2'],
  pending_twin: ['procedure-9', 'procedure-8'],
  false_other_claim: ['procedure-10'],
  policy_claim: ['procedure-12', 'procedure-5'],
  bank_unreachable: ['procedure-10'],
  missing_agent_activity: ['procedure-10'],
  default: ['procedure-4'],
};
/** Most procedures the brief shows. */
export const MAX_PROCEDURES = 3;

type CatalogEntry = {
  id: string;
  title: string;
  version: number;
  validFrom: string;
  validTo: string | null;
};

/**
 * The procedures for the findings, most severe finding first (`findings` arrive in severity
 * order), de-duplicated keeping the first, at most three. Each cites the version in force on
 * `caseDate` (`YYYY-MM-DD`; the wall clock is never read).
 */
export function selectProcedures(
  findings: Finding[],
  catalog: CatalogEntry[],
  caseDate: string,
): ProcedureRef[] {
  const wanted = (findings.length ? findings.map((f) => f.kind) : (['default'] as const)).flatMap(
    (because) => PROCEDURES_BY_FINDING[because].map((documentId) => ({ documentId, because })),
  );
  return wanted
    .filter((w, i) => wanted.findIndex((x) => x.documentId === w.documentId) === i)
    .slice(0, MAX_PROCEDURES)
    .map(({ documentId, because }) => {
      const versions = catalog.filter((d) => d.id === documentId);
      const inForce = versions.find(
        (d) => d.validFrom <= caseDate && (d.validTo === null || caseDate <= d.validTo),
      );
      return {
        documentId,
        version: inForce?.version ?? null,
        title: (inForce ?? versions[0])?.title ?? documentId,
        citation: inForce
          ? `[${documentId} v${inForce.version}]`
          : `[${documentId} — no version in force]`,
        because,
      };
    });
}
