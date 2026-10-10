import { config } from '../platform/config';
import { equal, sign } from '../platform/crypto';
import { HttpError } from '../platform/http/http-error';
import { person } from './people';
// Frozen surface (src/auth.ts): the shared primitives now live in platform/ and are re-exported
// here, so `HttpError` stays one class for every importer.
export { equal, sign, HttpError };
export function sessionToken(userId: string) {
  return `${userId}.${sign(userId, config.sessionSecret)}`;
}
export function actor(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('banana_actor='))
    ?.slice('banana_actor='.length);
  if (!token) throw new HttpError(401, 'Select a person to continue.');
  const [id, signature] = token.split('.');
  const p = person(id);
  if (!p || !signature || !equal(signature, sign(id, config.sessionSecret)))
    throw new HttpError(401, 'Invalid session.');
  return p;
}
/**
 * Browsers send Origin and Sec-Fetch-Site on cross-site POSTs, and the session cookie is
 * SameSite=Strict. A request with neither header is a non-browser client (curl, scripts), which
 * still needs the signed session cookie.
 */
export function sameOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new HttpError(403, 'Origin not allowed.');
  const origin = request.headers.get('origin');
  if (origin) {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.host !== request.headers.get('host')
    )
      throw new HttpError(403, 'Origin not allowed.');
  }
}
