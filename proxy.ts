// Next 16 Proxy (formerly Middleware; node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/proxy.md): runs in the Node.js runtime before every request, pages, assets
// and `/api` alike, because it has no `matcher`. It answers a `Host` outside the allowlist with the
// same 421 JSON as `src/server/handle.ts` (DNS rebinding, readiness P0-5): a rebound page must not
// even read the HTML or the client bundle. Returning nothing lets Next serve the request.
import { HttpError } from './src/platform/http/http-error';
import { json } from './src/platform/http/respond';
import { trustedHost } from './src/platform/http/trusted-host';
export function proxy(request: Request): Response | undefined {
  try {
    trustedHost(request);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    throw e;
  }
  return undefined;
}
