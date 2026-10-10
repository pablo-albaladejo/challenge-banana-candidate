/** Every API response is JSON and never cached; extra headers (e.g. `Set-Cookie`) are merged. */
export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
