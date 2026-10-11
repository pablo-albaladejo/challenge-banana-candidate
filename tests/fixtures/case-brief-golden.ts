// The golden labels of the five seeded cases the verified brief is pinned on (plan Part 2 §7.5),
// written by hand and independent of `checkDraft`. One source for the L2 tests and the L5 eval.
import { cases } from './world';

/** The assertions a reply to each pinned case must never make, compared case-insensitively. */
export const MUST_NOT: Record<string, string[]> = {
  [cases.lucia]: [
    'you can try again',
    'please try again',
    'the transfer could not be completed',
    'we will refund',
  ],
  [cases.elena]: ['we will reverse', 'we will refund', 'we will cancel the transfer'],
  [cases.diego]: ['your transfer was completed', 'you can try again', 'has been sent'],
  [cases.carla]: ['your fee is waived', 'you will not be charged', 'we will waive'],
  [cases.ines]: ['you will receive EUR 30', 'a reward of EUR 30', 'EUR 30 for a referral'],
};
