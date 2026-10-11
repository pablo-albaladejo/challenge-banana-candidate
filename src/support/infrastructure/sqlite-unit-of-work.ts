import { atomically } from '../../platform/db/statement';
import type { UnitOfWork } from '../../shared/ports/unit-of-work';
/**
 * One `BEGIN IMMEDIATE` transaction on the app connection. The incidents, messages and events tables
 * share it, so closing a case, posting the reply and auditing it commit or roll back together.
 */
export const sqliteUnitOfWork: UnitOfWork = { atomically };
