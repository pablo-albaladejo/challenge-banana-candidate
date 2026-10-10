// The real bank simulator as a black box over HTTP, exactly as the application reaches it.
// Evaluation may swap the bank for another implementation of docs/contracts.md, so application
// tests must never import simulator/* directly; they talk to this process instead.
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { config } from '../../src/config';
export type BankProfile =
  | 'normal'
  | 'intermittent'
  | 'reject-before'
  | 'lost-response'
  | 'slow-response'
  | 'read-unavailable';
export type BankSnapshot = {
  accounts: { id: string; userId: string; balanceCents: number }[];
  operations: {
    id: string;
    userId: string;
    reference: string;
    fromAccountId: string;
    toAccountId: string;
    amountCents: number;
  }[];
  movements: { id: string; accountId: string; amountCents: number }[];
};
let child: ChildProcess | undefined;
async function admin<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${config.bankUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.adminSecret}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(2000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Bank admin ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}
/** A port free right now, from a short-lived listener. */
async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
/** Points this process and the simulator it spawns at `port`. */
function moveBankTo(port: number) {
  process.env.BANK_PORT = String(port);
  process.env.BANK_URL = `http://127.0.0.1:${port}`;
  config.bankPort = port;
  config.bankUrl = process.env.BANK_URL;
}
const spawnBank = () =>
  spawn(process.execPath, ['--import', 'tsx', 'simulator/server.ts'], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
/**
 * Starts the simulator on the port reserved by tests/setup.ts and waits until it answers an admin
 * call with this file's admin secret. Health alone is not enough: the reserved port is released
 * before the bank binds it, and another file's proxy can take it in between, so health would answer
 * from a stranger's bank and two files would share one ledger. A stranger rejects the secret; when
 * the child exits (port taken) the bank moves to a fresh port.
 */
export async function startBank() {
  if (child) return;
  let started = spawnBank();
  let exited = false;
  const watch = (c: ChildProcess) => c.once('exit', () => c === started && (exited = true));
  watch(started);
  for (let attempt = 0, moves = 0; attempt < 100; attempt++) {
    if (exited) {
      if (++moves > 5) break;
      moveBankTo(await freePort());
      exited = false;
      watch((started = spawnBank()));
    }
    try {
      await admin('/admin/snapshot');
      child = started;
      return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  started.kill();
  throw new Error('The bank simulator did not become healthy.');
}
export async function stopBank() {
  child?.kill();
  child = undefined;
}
/** Restores seed balances and selects a scenario profile (the profile counter restarts). */
export async function resetBank(profile: BankProfile = 'normal', seed?: number) {
  await admin('/admin/reset', 'POST');
  await admin('/admin/scenario', 'POST', { profile, seed });
}
export const bankScenario = (profile: BankProfile, seed?: number) =>
  admin('/admin/scenario', 'POST', { profile, seed });
/** Test-only view of the ledger. The application itself must never use the admin API. */
export const bankSnapshot = () => admin<BankSnapshot>('/admin/snapshot');
export async function operationsFor(userId: string) {
  return (await bankSnapshot()).operations.filter((o) => o.userId === userId);
}
export async function balanceOf(accountId: string) {
  return (await bankSnapshot()).accounts.find((a) => a.id === accountId)!.balanceCents;
}
