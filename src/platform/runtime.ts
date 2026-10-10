import { randomUUID } from 'node:crypto';
import type { Clock } from '../shared/ports/clock';
import type { Ids } from '../shared/ports/ids';
/** The process clock: the default `Clock` of every vertical's wiring. */
export const systemClock: Clock = { now: () => new Date() };
/** Random UUIDs: the default `Ids` of every vertical's wiring. */
export const randomIds: Ids = { uuid: () => randomUUID() };
