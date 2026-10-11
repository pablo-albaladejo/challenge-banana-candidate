/**
 * Runs a synchronous step as one transaction, rolled back if it throws. The step must not be
 * async: better-sqlite3 rejects a step that returns a promise, so nothing may be awaited inside.
 */
export type UnitOfWork = { atomically<T>(step: () => T): T };
