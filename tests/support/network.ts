// Network fault injection between the application and the real bank. The bank still processes
// every request; the proxy can drop the response afterwards, like a connection lost after commit.
// It never changes the bank or mocks bankRequest: the application sees a genuine transport error.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { config } from '../../src/config';
export type LossyBank = { lost: number; close: () => Promise<void> };
/** Routes config.bankUrl through a proxy that loses the responses `lose` selects. */
export async function startLossyBank(
  lose: (method: string, path: string) => boolean,
): Promise<LossyBank> {
  const upstream = config.bankUrl;
  const state = { lost: 0 };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const response = await fetch(`${upstream}${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([k]) => k !== 'host' && k !== 'content-length'),
      ) as Record<string, string>,
      body: body || undefined,
    });
    const text = await response.text();
    if (lose(req.method || 'GET', (req.url || '').replace(/\?.*$/, ''))) {
      state.lost++;
      res.socket?.destroy();
      return;
    }
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(text);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  config.bankUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    get lost() {
      return state.lost;
    },
    close: () =>
      new Promise((resolve) => {
        config.bankUrl = upstream;
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
