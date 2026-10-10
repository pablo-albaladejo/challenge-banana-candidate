import {
  bankSnapshot,
  beforeEach,
  describe,
  expect,
  it,
  openAs,
  resetBank,
} from '../tests/support/e2e';
import { accounts, counts, money } from '../tests/fixtures/world';
describe('Customer overview', () => {
  beforeEach(() => resetBank());
  it('should greet the customer and show both of her accounts', async ({ page }) => {
    // Arrange
    // Act
    await openAs(page, 'Lucía Martín');
    // Assert
    await expect(page.getByRole('heading', { name: 'Hello, Lucía.' })).toBeVisible();
    await expect(page.getByText('Aurora account', { exact: true })).toBeVisible();
    await expect(page.getByText('Personal savings', { exact: true })).toBeVisible();
  });
});
describe('Transfers', () => {
  beforeEach(() => resetBank());
  it('should book a manual transfer once, only after the customer confirms it', async ({
    page,
  }) => {
    // Arrange
    const concept = `E2E dinner ${Date.now()}`;
    await openAs(page, 'Lucía Martín');
    await page.getByRole('navigation').getByRole('button', { name: 'Transfers' }).click();
    await page.getByLabel('Recipient').selectOption({ value: 'acc-bruno' });
    await page.getByLabel('Amount in euros').fill('12.34');
    await page.getByPlaceholder('What is this transfer for?').fill(concept);
    await page.getByRole('button', { name: 'Send transfer' }).click();
    await expect(page.getByRole('status')).toContainText('Review the proposal');
    expect((await bankSnapshot()).operations.filter((o) => o.concept === concept)).toHaveLength(0);
    // Act
    await page.getByRole('button', { name: 'Confirm these details' }).click();
    // Assert
    await expect(page.getByRole('status')).toContainText('Transfer confirmed and completed');
    const booked = (await bankSnapshot()).operations.filter((o) => o.concept === concept);
    expect(booked).toHaveLength(1);
    expect(booked[0].amountCents).toBe(1234);
  });
});
describe('Assistant', () => {
  beforeEach(() => resetBank());
  it('should answer an accounts question using the customer accounts', async ({ page }) => {
    // Arrange
    await openAs(page, 'Lucía Martín');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /^Assistant/ })
      .click();
    const composer = page.getByLabel('Message the assistant');
    // Act
    await composer.fill('What accounts do I have?');
    await composer.press('Enter');
    // Assert
    await expect(
      page.getByText('You have 2 accounts: Aurora account and Personal savings.'),
    ).toBeVisible();
  });
});
describe('Operator inbox', () => {
  it('should list the 17 support cases with 9 open', async ({ page }) => {
    // Arrange
    // Act
    await openAs(page, 'Marta Sanz · Operator');
    // Assert
    await expect(page.getByRole('heading', { name: 'Every case, a person.' })).toBeVisible();
    await expect(page.locator('.case-count strong')).toHaveText('9');
    await expect(page.locator('.case-item')).toHaveCount(17);
  });
  it('should open a case and show who the customer is', async ({ page }) => {
    // Arrange
    await openAs(page, 'Marta Sanz · Operator');
    const firstCase = page.locator('.case-item').first();
    const customer = (await firstCase.locator('strong').textContent())!;
    // Act
    await firstCase.click();
    // Assert
    await expect(page.getByRole('heading', { level: 2, name: customer })).toBeVisible();
  });
});
describe('Document library', () => {
  it('should show customers the 68 public documents only', async ({ page }) => {
    // Arrange
    await openAs(page, 'Lucía Martín');
    // Act
    await page.getByRole('navigation').getByRole('button', { name: 'Documents' }).click();
    // Assert
    await expect(page.getByText('68 sources')).toBeVisible();
  });
  it('should show operators all 80 documents', async ({ page }) => {
    // Arrange
    await openAs(page, 'Marta Sanz · Operator');
    // Act
    await page.getByRole('navigation').getByRole('button', { name: 'Documents' }).click();
    // Assert
    await expect(page.getByText('80 sources')).toBeVisible();
  });
});
describe('Document search and reader', () => {
  it('should show retrieved excerpts for a search and open a document in the reader', async ({
    page,
  }) => {
    // Arrange
    await openAs(page, 'Lucía Martín');
    await page.getByRole('navigation').getByRole('button', { name: 'Documents' }).click();
    await expect(page.getByText(`${counts.publicDocuments} sources`)).toBeVisible();
    const firstDocument = page.locator('.document-list button').first();
    const title = (await firstDocument.locator('strong').textContent())!;
    // Act
    await page.getByLabel('Search documents').fill('When is the Aurora account fee waived?');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await firstDocument.click();
    // Assert
    await expect(page.getByRole('heading', { name: 'Retrieved excerpts' })).toBeVisible();
    await expect(page.locator('.search-results article').first()).toBeVisible();
    await expect(
      page.locator('.document-reader').getByRole('heading', { level: 2, name: title }),
    ).toBeVisible();
  });
});
describe('Conversations', () => {
  it('should list a new conversation as soon as the customer starts it', async ({ page }) => {
    // Arrange
    await openAs(page, 'Lucía Martín');
    const list = page.locator('.conversation-list button');
    await expect(list.first()).toBeVisible();
    const before = await list.count();
    // Act
    await page
      .locator('.history-heading')
      .getByRole('button', { name: 'New conversation' })
      .click();
    // Assert
    await expect(list).toHaveCount(before + 1);
    await expect(page.locator('.conversation-list button.selected')).toHaveText('New conversation');
    await expect(page.getByRole('heading', { name: 'Your assistant' })).toBeVisible();
  });
});
describe('Persona switch', () => {
  it('should keep the operator workspace free of a customer dashboard that arrives late', async ({
    page,
  }) => {
    // Arrange
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let delivered!: () => void;
    const lateDashboard = new Promise<void>((resolve) => (delivered = resolve));
    let dashboards = 0;
    await page.route('**/api/dashboard', async (route) => {
      // Holds only the first dashboard request; later ones (a StrictMode re-run, the operator's)
      // pass through.
      if (++dashboards > 1) return route.continue();
      // Fetched now, with the customer's session; handed to the page only after the switch.
      const response = await route.fetch();
      await released;
      await route.fulfill({ response });
      delivered();
    });
    await page.goto('/');
    const selector = page.getByLabel('Switch person');
    await expect(selector).toBeEnabled();
    // Act
    await selector.selectOption({ label: 'Marta Sanz · Operator' });
    await expect(page.locator('.case-item')).toHaveCount(counts.cases);
    release();
    await lateDashboard;
    // Gives the page time to apply the late response, if it wrongly does.
    await page.waitForTimeout(1000);
    // Assert: a customer dashboard has no incidents, so applying it would empty the case list.
    await expect(page.getByRole('heading', { name: 'Every case, a person.' })).toBeVisible();
    await expect(page.locator('.case-item')).toHaveCount(counts.cases);
    await expect(page.locator('.case-count strong')).toHaveText(
      String(counts.cases - counts.closedCases),
    );
  });
});
describe('Rejected transfer', () => {
  beforeEach(() => resetBank());
  it('should show the bank reason in a dismissible notice when the bank rejects a transfer', async ({
    page,
  }) => {
    // Arrange
    const concept = `E2E too much ${Date.now()}`;
    const notice = page
      .getByRole('status')
      .filter({ has: page.getByRole('button', { name: 'Dismiss notice' }) });
    await openAs(page, 'Bruno Vidal');
    await page.getByRole('navigation').getByRole('button', { name: 'Transfers' }).click();
    await page.getByLabel('Recipient').selectOption({ value: accounts.lucia });
    await page.getByLabel('Amount in euros').fill(String(money.maxTransferCents / 100));
    await page.getByPlaceholder('What is this transfer for?').fill(concept);
    await page.getByRole('button', { name: 'Send transfer' }).click();
    await expect(notice).toContainText('Review the proposal');
    // Act
    await page.getByRole('button', { name: 'Confirm these details' }).click();
    // Assert
    await expect(notice).toContainText('Insufficient funds');
    await notice.getByRole('button', { name: 'Dismiss notice' }).click();
    await expect(notice).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'Recent transfer checks' }),
    ).toContainText('Not executed');
    expect((await bankSnapshot()).operations.filter((o) => o.concept === concept)).toHaveLength(0);
  });
});
