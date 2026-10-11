import type { PeopleDirectory } from '../ports/people-directory';

/** Every selectable person, in roster order. Public: no session needed. */
export const makeListPeople =
  ({ people }: { people: PeopleDirectory }) =>
  () =>
    people.all();
