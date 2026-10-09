// Calls the Next.js catch-all route handler in-process, with a signed session cookie,
// the same way the browser reaches it. No Next server is needed.
import { GET, POST } from '../../app/api/[...path]/route';
import { sessionToken } from '../../src/auth';
export type ApiResponse<T = any> = { status: number; body: T; headers: Headers };
export async function api<T = any>(
  method: 'GET' | 'POST',
  path: string,
  options: { as?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResponse<T>> {
  const url = new URL(`http://127.0.0.1:3000/api/${path}`);
  const headers: Record<string, string> = { ...options.headers };
  if (options.as) headers.cookie = `banana_actor=${sessionToken(options.as)}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const segments = url.pathname
    .replace(/^\/api\//, '')
    .split('/')
    .filter(Boolean);
  const response = await (method === 'GET' ? GET : POST)(request, {
    params: Promise.resolve({ path: segments }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
    headers: response.headers,
  };
}
