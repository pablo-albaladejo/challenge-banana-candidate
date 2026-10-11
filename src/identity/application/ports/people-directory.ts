import type { Person } from '../../../types';
/** The people who may hold a session: everyone, in roster order, or one by id. */
export type PeopleDirectory = { all(): readonly Person[]; find(id: string): Person | undefined };
