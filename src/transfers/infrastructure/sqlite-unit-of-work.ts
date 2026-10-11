import { atomically } from '../../platform/db/statement';
import type { UnitOfWork } from '../../shared/ports/unit-of-work';
/** One `BEGIN IMMEDIATE` transaction on the app connection. */
export const sqliteUnitOfWork: UnitOfWork = { atomically };
