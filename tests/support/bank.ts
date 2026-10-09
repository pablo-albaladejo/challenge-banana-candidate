// The real bank simulator as a black box over HTTP, exactly as the application reaches it.
// Evaluation may swap the bank for another implementation of docs/contracts.md, so application
// tests must never import simulator/* directly; they talk to this process instead.
import { spawn, type ChildProcess } from 'node:child_process';
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
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Bank admin ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}
/** Starts the simulator on the port reserved by tests/setup.ts and waits until it is healthy. */
export async function startBank() {
  if (child) return;
  child = spawn(process.execPath, ['--import', 'tsx', 'simulator/server.ts'], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${config.bankUrl}/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
