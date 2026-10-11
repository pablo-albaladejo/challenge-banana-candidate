/**
 * Intents whose dispatch is in flight in this process; reconcile leaves them to the dispatch. A
 * restart empties it, so reconcile recovers a crashed dispatch once it is stale.
 */
export type DispatchRegistry = {
  add(intentId: string): void;
  delete(intentId: string): void;
  has(intentId: string): boolean;
};
