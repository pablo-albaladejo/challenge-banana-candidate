// Playwright aliases so E2E journeys keep the project convention:
// describe per journey, it('should …') per case, AAA comments in the body.
import http from 'node:http';
import { test, expect, type Page } from '@playwright/test';
import { e2e } from './e2e-env';
export const describe = test.describe;
export const it = test;
export const beforeEach = test.beforeEach;
export { expect };
export type BankProfile = 'normal' | 'intermittent' | 'lost-response' | 'slow-response';
async function admin(path: string, body?: unknown) {
  const response = await fetch(`${e2e.bankUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${e2e.adminSecret}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Bank admin ${path} returned ${response.status}`);
  return response.json();
}
/** Test-only: restores seed balances and selects a bank scenario. */
export async function resetBank(profile: BankProfile = 'normal', seed?: number) {
  await admin('/admin/reset', {});
  await admin('/admin/scenario', { profile, seed });
}
/** Test-only view of the bank ledger. */
export const bankSnapshot = (): Promise<{
  accounts: { id: string; balanceCents: number }[];
  operations: { userId: string; amountCents: number; concept: string }[];
}> => admin('/admin/snapshot');
/** Opens the app as a person, through the same selector a user would use. */
export async function openAs(page: Page, name: string) {
  await page.goto('/');
  const selector = page.getByLabel('Switch person');
  await expect(selector).toBeEnabled();
  await selector.selectOption({ label: name });
  await expect(page.getByText('Getting things ready…')).toBeHidden();
}
/**
 * GETs a path of the app stack with an explicit `Host` header, as a browser does after a DNS
 * rebinding: `node:http`, because `fetch` and Playwright set `Host` from the URL.
 */
export function getWithHost(path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port: e2e.appPort, path, headers: { host } });
    request.on('response', (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('error', reject);
  });
}
