import type { PeopleDirectory } from '../ports/people-directory';

/** One person by id, or undefined. What other verticals use to learn a person's role. */
export const makeFindPerson =
  ({ people }: { people: PeopleDirectory }) =>
  ({ id }: { id: string }) =>
    people.find(id);
