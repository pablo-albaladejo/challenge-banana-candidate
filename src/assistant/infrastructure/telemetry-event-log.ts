import { recordEvent } from '../../platform/telemetry/telemetry';
import type { EventLog } from '../application/ports/event-log';
/** Agent and tool events go to the app's telemetry `events` table. */
export const telemetryEventLog: EventLog = { record: recordEvent };
