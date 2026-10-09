// Matches path segments against an ordered route table. Patterns are `/`-separated: a literal,
// `:name` (one required segment) or a final `*name` (any remaining segments, possibly none).
// `ANY` accepts every method; the first match wins and no match is `null` (the caller's 404).
export type Method = 'GET' | 'POST' | 'ANY';
export type Route<H> = { method: Method; pattern: string; handler: H };
export type Match<H> = { handler: H; params: Record<string, string>; rest: string[] };
function matchPattern(pattern: string, segments: string[]) {
  const parts = pattern.split('/');
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('*')) return { params, rest: segments.slice(i) };
    const segment = segments[i];
    if (!segment) return null;
    if (part.startsWith(':')) params[part.slice(1)] = segment;
    else if (part !== segment) return null;
  }
  return segments.length === parts.length ? { params, rest: [] } : null;
}
export function match<H>(routes: Route<H>[], method: string, segments: string[]): Match<H> | null {
  for (const route of routes) {
    if (route.method !== 'ANY' && route.method !== method) continue;
    const found = matchPattern(route.pattern, segments);
    if (found) return { handler: route.handler, ...found };
  }
  return null;
}
