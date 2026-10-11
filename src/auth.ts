// Frozen path (src/public-surface.test.ts): `sign`, `equal` and `HttpError` are platform
// primitives; `actor`, `sameOrigin` and `sessionToken` come from the identity vertical's guard and
// legacy files (not its index, which does not publish `sessionToken`).
export { equal, sign } from './platform/crypto';
export { HttpError } from './platform/http/http-error';
export { actor, sameOrigin } from './identity/entry-points/http/session-guard';
export { sessionToken } from './identity/entry-points/legacy';
