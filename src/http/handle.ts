import { actor, sameOrigin, HttpError } from '../auth';
import { match } from './router';
import { publicRoutes, routes } from './routes';
import { toErrorResponse } from './errors';
type CatchAllContext = { params: Promise<{ path: string[] }> };
/**
 * The single entry point behind `app/api/[...path]/route.ts`, in this order: `sameOrigin` for every
 * POST, then the public routes, then the actor from the signed cookie (so an unknown route without
 * a session is a 401), then the route table (no match is a 404, never a 405). Errors map to JSON.
 */
export async function handle(request: Request, context: CatchAllContext) {
  try {
    const { path } = await context.params;
    if (request.method === 'POST') sameOrigin(request);
    const open = match(publicRoutes, request.method, path);
    if (open) return await open.handler({ request, params: open.params });
    const current = actor(request);
    const found = match(routes, request.method, path);
    if (!found) throw new HttpError(404, 'Route not found.');
    return await found.handler({ request, params: found.params, actor: current });
  } catch (e) {
    return toErrorResponse(e);
  }
}
