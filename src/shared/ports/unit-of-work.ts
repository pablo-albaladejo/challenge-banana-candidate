/** Runs a synchronous step as one transaction, rolled back if it throws. */
export type UnitOfWork = { atomically<T>(step: () => T): T };
