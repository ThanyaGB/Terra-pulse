import { expect, test, type Page } from '@playwright/test';

/** Reads a tonnage figure such as "1,234.5 t" from a test id. */
async function tonnes(page: Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).textContent()) ?? '';
  return Number(text.replace(/[^0-9.]/g, ''));
}

test('Buyer: claim an offer, record its receipt, and see verification and the FPO tile follow', async ({ page }) => {
  await page.goto('/fpo');
  await expect(page.getByTestId('straw-collected')).toBeVisible();
  const collectedBefore = await tonnes(page, 'straw-collected');

  await page.goto('/buyer');
  await expect(page.getByRole('heading', { name: 'Straw supply desk' })).toBeVisible();
  await expect(page.getByTestId('kpi-held')).toBeVisible();

  // claim the Moonak offer: the confirmation shows tonnes and window before submit
  await page.getByRole('button', { name: 'Claim straw from Moonak, PG-MOO' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Claim straw from Moonak');
  await expect(dialog).toContainText('PG-MOO');
  await dialog.getByRole('button', { name: 'Confirm claim' }).click();

  // the new claim is selected: payment is held until verified
  const form = page.getByRole('form', { name: 'Weighbridge receipt' });
  await expect(form).toBeVisible();
  await expect(page.getByTestId('payment-status')).toContainText('Held until verified');

  // weigh in: 21,000 kg gross less 9,000 kg tare = 12.0 t, matching the 12 t claim
  await form.getByLabel('Gross weight (kg)').fill('21000');
  await form.getByLabel('Tare weight (kg)').fill('9000');
  await expect(page.getByTestId('receipt-net')).toContainText('12.00 t');
  await form.getByRole('button', { name: 'Attach slip photo (demo)' }).click();
  await form.getByRole('button', { name: 'Record receipt' }).click();

  // verification updates: reconciliation matched and the fire check passed, so payment is released
  await expect(page.getByTestId('check-recon')).toContainText('Matched');
  await expect(page.getByTestId('check-firms')).toContainText('Pass');
  await expect(page.getByTestId('payment-status')).toContainText('Released');

  // the FPO tile shows the new collected tonnage in the same browser session
  await page.goto('/fpo');
  await expect(page.getByTestId('straw-collected')).toBeVisible();
  expect(await tonnes(page, 'straw-collected')).toBeGreaterThan(collectedBefore);
});

test('Buyer: a village filter from the FPO tile keeps only those villages', async ({ page }) => {
  await page.goto('/buyer?villages=sunam,moonak');
  await expect(page.getByRole('button', { name: /Claim straw from Moonak/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Claim straw from Dhuri/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Show all villages' })).toBeVisible();
});
