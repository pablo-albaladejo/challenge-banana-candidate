import {
  bankSnapshot,
  beforeEach,
  describe,
  expect,
  it,
  openAs,
  resetBank,
} from '../tests/support/e2e';
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
  it('should complete a manual transfer and book it once at the bank', async ({ page }) => {
    // Arrange
    const concept = `E2E dinner ${Date.now()}`;
    await openAs(page, 'Lucía Martín');
    await page.getByRole('navigation').getByRole('button', { name: 'Transfers' }).click();
    await page.getByLabel('Recipient').selectOption({ value: 'acc-bruno' });
    await page.getByLabel('Amount in euros').fill('12.34');
    await page.getByPlaceholder('What is this transfer for?').fill(concept);
    // Act
    await page.getByRole('button', { name: 'Send transfer' }).click();
    // Assert
    await expect(page.getByRole('status')).toContainText('Transfer completed');
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
