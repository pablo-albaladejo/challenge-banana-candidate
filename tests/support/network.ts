// Network fault injection between the application and the real bank. The bank still processes
// every request; the proxy can then spoil the response, like a connection lost after commit or a
// gateway that answers with its own error page. It never changes the bank or mocks bankRequest:
// the application sees a genuine transport fault.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { config } from '../../src/platform/config';
export type LossyBank = {
  /** How many responses the fault selected (for `hang`: how many requests it is holding or held). */
  lost: number;
  /** `hang` only: lets every held request through to the bank, and any later one straight away. */
  release: () => void;
  close: () => Promise<void>;
};
/**
 * What the proxy does to a selected response, always after the bank has processed the request:
 * - `drop`: closes the connection without answering (a lost response);
 * - `html-502`: answers `502 text/html`, as a gateway in front of the bank would;
 * - `empty`: answers `200` with an empty body;
 * - `truncated`: sends the bank's status and the first half of its body, then closes the connection.
 * - `hang`: the exception, applied before the bank: holds the request (the bank has not seen it) until
 *   `release()`, then forwards it and answers normally, like a dispatch still in flight.
 */
export type NetworkFault = 'drop' | 'html-502' | 'empty' | 'truncated' | 'hang';
/** Routes config.bankUrl through a proxy that applies `fault` to the responses `lose` selects. */
export async function startLossyBank(
  lose: (method: string, path: string) => boolean,
  fault: NetworkFault = 'drop',
): Promise<LossyBank> {
  const upstream = config.bankUrl;
  const state = { lost: 0 };
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const selected = lose(req.method || 'GET', (req.url || '').replace(/\?.*$/, ''));
    if (selected && fault === 'hang') {
      state.lost++;
      await released;
    }
    const response = await fetch(`${upstream}${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([k]) => k !== 'host' && k !== 'content-length'),
      ) as Record<string, string>,
      body: body || undefined,
    });
    const text = await response.text();
    if (selected && fault !== 'hang') {
      state.lost++;
      if (fault === 'html-502') {
        res.writeHead(502, { 'content-type': 'text/html' });
        res.end('<html><body><h1>502 Bad Gateway</h1></body></html>');
      } else if (fault === 'empty') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end();
      } else if (fault === 'truncated') {
        res.writeHead(response.status, {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(text)),
        });
        res.write(text.slice(0, Math.floor(text.length / 2)), () => res.socket?.destroy());
      } else res.socket?.destroy();
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
    release: () => release(),
    close: () =>
      new Promise((resolve) => {
        release();
        config.bankUrl = upstream;
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
