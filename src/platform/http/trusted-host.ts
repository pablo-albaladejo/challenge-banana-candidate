import { config } from '../config';
import { HttpError } from './http-error';
/**
 * Pure: the `Host` values the app answers. Always `127.0.0.1:<appPort>` and `localhost:<appPort>`
 * (what `npm run dev` binds and the browser sends), plus every comma-separated entry of
 * `ALLOWED_HOSTS`, trimmed and lower-cased, written as the browser sends it (`app.example`, or
 * `app.example:8443` off the default port). Empty entries are ignored.
 */
export function allowedHosts(env: Record<string, string | undefined>, appPort: number) {
  const extra = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([`127.0.0.1:${appPort}`, `localhost:${appPort}`, ...extra]);
}
/**
 * Pure: the one startup warning `register()` logs in production about `ALLOWED_HOSTS`, or
 * `undefined`. Empty means only the loopback hosts are answered, so a deployment behind a real name
 * would refuse every request with 421. An entry with a `/` (a scheme or a path) or a `:` not
 * followed by a port never equals a `Host` header, so it allows nothing. It only warns: startup
 * never fails over it.
 */
export function allowedHostsWarning(env: Record<string, string | undefined>) {
  const entries = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (!entries.length)
    return 'ALLOWED_HOSTS is empty: only 127.0.0.1 and localhost on APP_PORT are answered.';
  const unusable = entries.filter((h) => /\/|:(?!\d+$)/.test(h));
  if (unusable.length)
    return `ALLOWED_HOSTS lists entries a Host header never carries (write host or host:port): ${unusable.join(', ')}`;
  return undefined;
}
/**
 * DNS rebinding guard (readiness P0-5): a page on `evil.test` that re-resolves its name to
 * 127.0.0.1 reaches the app with `Host: evil.test:<port>` and a matching `Origin`, so `sameOrigin`
 * passes. Any request whose `Host` is missing or not in `allowedHosts` is a 421 `Unknown host.`,
 * whatever its method. `ALLOWED_HOSTS` is read from `process.env` on every request; `APP_PORT`
 * comes from `config.appPort`, read once when the config module loads.
 */
export function trustedHost(request: Request) {
  const host = (request.headers.get('host') ?? '').toLowerCase();
  if (!allowedHosts(process.env, config.appPort).has(host))
    throw new HttpError(421, 'Unknown host.');
}
