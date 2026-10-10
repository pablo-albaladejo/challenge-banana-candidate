// Matches path segments against an ordered route table. Patterns are `/`-separated: a literal or
// `:name` (one required segment); the path must have exactly as many segments as the pattern.
// HEAD matches GET routes; the first match wins and no match is `null` (the caller's 404 or 405).
export type Method = 'GET' | 'POST';
export type Route<H> = { method: Method; pattern: string; handler: H };
export type Match<H> = { handler: H; params: Record<string, string> };
function matchPattern(pattern: string, segments: string[]) {
  const parts = pattern.split('/');
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const segment = segments[i];
    if (!segment) return null;
    if (part.startsWith(':')) params[part.slice(1)] = segment;
    else if (part !== segment) return null;
  }
  return params;
}
export function match<H>(routes: Route<H>[], method: string, segments: string[]): Match<H> | null {
  const wanted = method === 'HEAD' ? 'GET' : method;
  for (const route of routes) {
    if (route.method !== wanted) continue;
    const params = matchPattern(route.pattern, segments);
    if (params) return { handler: route.handler, params };
  }
  return null;
}
/**
 * The methods the path accepts, each once and sorted: the `Allow` of a 405. HEAD is listed with
 * GET, since it is answered as GET.
 */
export function allowedMethods<H>(routes: Route<H>[], segments: string[]): string[] {
  const methods = new Set<string>();
  for (const route of routes) {
    if (!matchPattern(route.pattern, segments)) continue;
    methods.add(route.method);
    if (route.method === 'GET') methods.add('HEAD');
  }
  return [...methods].sort();
}
