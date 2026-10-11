import { BadRequestError } from '../../../shared/domain/errors';
import type { PeopleDirectory } from '../ports/people-directory';
import type { SessionTokens } from '../ports/session-tokens';

/**
 * Selects a person (persona switching is unauthenticated by design) and issues their session
 * token. An id outside the directory is rejected and no token is issued.
 */
export const makeStartSession =
  ({ people, tokens }: { people: PeopleDirectory; tokens: SessionTokens }) =>
  ({ userId }: { userId: string }) => {
    const person = people.find(userId);
    if (!person) throw new BadRequestError('Unknown person.');
    return { person, token: tokens.issue(userId) };
  };
