import type { PeopleDirectory } from '../ports/people-directory';
import type { SessionTokens } from '../ports/session-tokens';

/**
 * The person behind a session token, or undefined when its signature is invalid or the id is not
 * in the directory. The role always comes from the directory: the token carries only the id.
 */
export const makeVerifySession =
  ({ tokens, people }: { tokens: SessionTokens; people: PeopleDirectory }) =>
  ({ token }: { token: string }) => {
    const id = tokens.verify(token);
    return id === undefined ? undefined : people.find(id);
  };
