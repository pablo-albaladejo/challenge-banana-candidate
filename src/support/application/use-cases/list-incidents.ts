import type { IncidentRepository } from '../ports/incident-repository';

/** Every support case, newest first. The caller gates the operator role. */
export const makeListIncidents =
  ({ incidents }: { incidents: IncidentRepository }) =>
  () =>
    incidents.all();
