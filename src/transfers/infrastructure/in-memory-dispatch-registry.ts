import type { DispatchRegistry } from '../application/ports/dispatch-registry';
/** The in-flight dispatches of this process: one per wired graph, emptied by a restart. */
export function inMemoryDispatchRegistry(): DispatchRegistry {
  const dispatching = new Set<string>();
  return {
    add: (intentId) => void dispatching.add(intentId),
    delete: (intentId) => void dispatching.delete(intentId),
    has: (intentId) => dispatching.has(intentId),
  };
}
