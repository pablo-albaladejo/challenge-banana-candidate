import { config } from '../../platform/config';
import { equal, sign } from '../../platform/crypto';
import type { SessionTokens } from '../application/ports/session-tokens';
/**
 * `id.signature`, where the signature is the hex HMAC-SHA256 of the id under
 * `config.sessionSecret`, read at call time (tests rotate it). No expiry and no nonce: the same id
 * always gets the same token. `verify` reads the first two dot-separated parts only and compares
 * the signature in constant time (`equal`).
 */
export const hmacSessionTokens: SessionTokens = {
  issue: (userId) => `${userId}.${sign(userId, config.sessionSecret)}`,
  verify: (token) => {
    const [id, signature] = token.split('.');
    return signature && equal(signature, sign(id, config.sessionSecret)) ? id : undefined;
  },
};
