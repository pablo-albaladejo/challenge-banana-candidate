import type { Person } from '../../../types';
/** Who a person is. Wired to `identity().findPerson`. */
export type People = { find(id: string): Person | undefined };
