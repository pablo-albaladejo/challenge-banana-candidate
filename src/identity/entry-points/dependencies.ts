import { peopleRoster } from '../infrastructure/people-roster';
import { hmacSessionTokens } from '../infrastructure/hmac-session-tokens';
import { makeVerifySession } from '../application/use-cases/verify-session';
import { makeListPeople } from '../application/use-cases/list-people';
import { makeStartSession } from '../application/use-cases/start-session';
import { makeFindPerson } from '../application/use-cases/find-person';
import type { PeopleDirectory } from '../application/ports/people-directory';
import type { SessionTokens } from '../application/ports/session-tokens';
export type IdentityDeps = { people: PeopleDirectory; tokens: SessionTokens };
/**
 * No overrides: no identity use case reads the clock or ids (the token has no expiry and no
 * nonce), and the roster and the signer are always the real ones. No `internals` either.
 */
const defaults = (): IdentityDeps => ({ people: peopleRoster, tokens: hmacSessionTokens });
export function wireIdentity() {
  const deps = defaults();
  return {
    verifySession: makeVerifySession(deps),
    listPeople: makeListPeople(deps),
    startSession: makeStartSession(deps),
    findPerson: makeFindPerson(deps),
  };
}
/** What index.ts exposes: the use cases. */
export type IdentityApp = ReturnType<typeof wireIdentity>;
let graph: IdentityApp | undefined;
export const identity = (): IdentityApp => (graph ??= wireIdentity());
