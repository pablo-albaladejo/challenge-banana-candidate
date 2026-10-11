import type { Person } from '../../../types';
export type CustomerDirectory = { roleOf(userId: string): Person['role'] | undefined };
