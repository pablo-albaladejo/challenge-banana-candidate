// Playwright aliases so E2E journeys keep the project convention:
// describe per journey, it('should …') per case, AAA comments in the body.
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
