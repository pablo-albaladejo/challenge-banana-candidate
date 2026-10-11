import type { Person } from '../../../types';
/** Who a person is. Wired to `person` from the identity index (until 7d.4). */
export type People = { find(id: string): Person | undefined };
