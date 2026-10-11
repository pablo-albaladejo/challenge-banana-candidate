import type { IncidentRepository } from '../ports/incident-repository';

/** What an operator's dashboard shows: every support case, newest first. The caller gates the role. */
export const makeGetOperatorWorkspace =
  ({ incidents }: { incidents: IncidentRepository }) =>
  () => ({ incidents: incidents.all() });
