import { eventsIn } from '../../platform/telemetry/events.repo';
import type { EventReader } from '../application/ports/event-reader';
/** The `events` table, read in recording order. */
export const telemetryEventReader: EventReader = { inConversation: eventsIn };
