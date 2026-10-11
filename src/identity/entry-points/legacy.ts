// Frozen-signature function the `src/auth.ts` shim re-exports (with `actor` and `sameOrigin` from
// ./http/session-guard). `sign`, `equal` and `HttpError` are platform primitives, and `src/people.ts`
// re-exports the roster file directly, so neither goes through here. Not on the index: no vertical
// may mint a session.
import { hmacSessionTokens } from '../infrastructure/hmac-session-tokens';
/** The signed token for any id, known or not (tests forge sessions for unknown people with it). */
export const sessionToken = (userId: string) => hmacSessionTokens.issue(userId);
