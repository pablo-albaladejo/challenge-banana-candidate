/**
 * What evidence of a case is missing, named in one sentence each and joined by a space; `null`
 * when nothing is. Evidence that was never recorded is named, never invented.
 */
export function caseGaps({
  hasEvents,
  bankReachable,
}: {
  hasEvents: boolean;
  bankReachable: boolean;
}): string | null {
  const gaps: string[] = [];
  if (!hasEvents) gaps.push('No agent activity was recorded for this conversation.');
  if (!bankReachable) gaps.push('The bank could not be reached, so its operations are not shown.');
  return gaps.length ? gaps.join(' ') : null;
}
/** The bank operations whose reference one of the case's intents holds, in the bank's order. */
export function operationsFor<O extends { reference: string }>(
  operations: O[],
  intents: { bank_reference: string | null }[],
): O[] {
  const references = new Set(intents.map((i) => i.bank_reference).filter(Boolean));
  return operations.filter((o) => references.has(o.reference));
}
