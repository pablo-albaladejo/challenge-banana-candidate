import { actor, sameOrigin } from '../identity';
import { HttpError } from '../platform/http/http-error';
import { trustedHost } from '../platform/http/trusted-host';
import { allowedMethods, match } from '../platform/http/router';
import { publicRoutes, routes } from './routes';
import { toErrorResponse } from '../platform/http/errors';
import { json } from '../platform/http/respond';
type CatchAllContext = { params: Promise<{ path: string[] }> };
const methodNotAllowed = (allow: string[]) =>
  json({ error: 'Method not allowed.' }, 405, { Allow: allow.join(', ') });
/**
 * The single entry point behind `app/api/[...path]/route.ts`, in this order: `trustedHost` for every
 * method (a 421 for a `Host` outside the allowlist, against DNS rebinding, P0-5; the root `proxy.ts`
 * applies the same check to pages), `sameOrigin` for every POST, then the public routes (a wrong method on a public-only path is a 405), then the actor from
 * the signed cookie (so an unknown or wrong-method private route without a session is a 401), then
 * the route table: a known path with another method is a 405 with `Allow`, an unknown one a 404.
 * A route switched off by its `enabled` check (the persona switcher, P0-7) counts as absent at
 * every step. HEAD is answered as GET. Errors map to JSON.
 */
export async function handle(request: Request, context: CatchAllContext) {
  try {
    const { path } = await context.params;
    trustedHost(request);
    if (request.method === 'POST') sameOrigin(request);
    const open = match(publicRoutes, request.method, path);
    if (open) return await open.handler({ request, params: open.params });
    const privateAllow = allowedMethods(routes, path);
    const allow = allowedMethods<unknown>([...publicRoutes, ...routes], path);
    if (allow.length && !privateAllow.length) return methodNotAllowed(allow);
    const current = actor(request);
    const found = match(routes, request.method, path);
    if (found) return await found.handler({ request, params: found.params, actor: current });
    if (allow.length) return methodNotAllowed(allow);
    throw new HttpError(404, 'Route not found.');
  } catch (e) {
    return toErrorResponse(e);
  }
}
