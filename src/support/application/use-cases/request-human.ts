import { OPEN } from '../../domain/incident';
import type { Clock } from '../../../shared/ports/clock';
import type { Ids } from '../../../shared/ports/ids';
import type { IncidentRepository } from '../ports/incident-repository';

/**
 * Opens a support case for the conversation, or reuses its open one: one open case per
 * conversation. The tool checks the conversation and parses the summary first; the caller has
 * already checked that `userId` owns the conversation.
 */
export const makeRequestHuman =
  ({ incidents, clock, ids }: { incidents: IncidentRepository; clock: Clock; ids: Ids }) =>
  ({
    userId,
    conversationId,
    summary,
  }: {
    userId: string;
    conversationId: string;
    summary: string;
  }) => {
    const existing = incidents.openIn(conversationId);
    const id = existing?.id || ids.uuid();
    if (!existing)
      incidents.insert({
        id,
        userId,
        conversationId,
        summary,
        status: OPEN,
        createdAt: clock.now().toISOString(),
      });
    return { status: OPEN, incidentId: id };
  };
