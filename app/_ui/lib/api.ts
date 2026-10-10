/** Server data as the UI receives it; shapes are not shared with the client beyond `Person`. */
export type AnyRecord = Record<string, any>;
/** Calls `/api/{path}`: GET without a body, POST with JSON; throws the server's `error`. */
export async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
