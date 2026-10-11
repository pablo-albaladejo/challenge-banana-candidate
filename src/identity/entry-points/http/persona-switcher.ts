import { featureFlags } from '../../../platform/config';
import { HttpError } from '../../../platform/http/http-error';
/**
 * The demo persona switcher (P0-7), read per request from `DEMO_PERSONA_SWITCHER`. Off, the route
 * table (`src/server/routes.ts`) drops `GET people` and `POST session`, so the router answers them
 * like any absent route: 401 without a session, then 404, or 405 for `session` (`GET` remains).
 */
export const personaSwitcherEnabled = () => featureFlags.demoPersonaSwitcher;
/**
 * Defence in depth for the two handlers, should they be reached with the switcher off: the
 * unknown-route answer (404 `Route not found.`), before the body is read. A 403 would confirm a
 * switched-off endpoint.
 */
export function requirePersonaSwitcher() {
  if (!personaSwitcherEnabled()) throw new HttpError(404, 'Route not found.');
}
