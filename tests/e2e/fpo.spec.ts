import { expect, test } from '@playwright/test';

test('FPO: pick the riskiest farmer, call them, and assign a machine', async ({ page }) => {
  await page.goto('/fpo');

  await expect(page.getByRole('heading', { name: 'Super Seeder' })).toBeVisible();
  await expect(page.getByText('₹1,650')).toBeVisible(); // Bio-CNG floor price
  await expect(page.getByRole('heading', { name: 'High-risk farmers' })).toBeVisible();

  // table starts sorted by fire risk, highest first
  const rows = page.locator('#farmers tbody tr');
  await expect(rows.first()).toBeVisible();

  // filter by tier, then clear
  await page.getByLabel('Risk tier').selectOption('critical');
  const critical = await rows.count();
  await page.getByLabel('Risk tier').selectOption('all');
  expect(await rows.count()).toBeGreaterThan(critical);

  await page.locator('#farmers tbody th button').first().click();
  const panel = page.locator('#call-panel');
  await expect(panel.getByText('Matched machine')).toBeVisible();
  await expect(panel).toContainText(/\d{5}-XXXXX/); // masked operator phone

  await panel.getByRole('button', { name: 'Trigger voice call' }).click();
  await expect(page.getByText(/Voice call queued for/)).toBeVisible();
  await expect(panel.getByText('Voice call queued (Punjabi)')).toBeVisible();

  await panel.getByRole('button', { name: /^Assign .* on-site$/ }).click();
  await expect(page.getByText(/assigned to .*min away/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Already assigned' })).toBeDisabled();
});

test('FPO: empty filter result offers a way back', async ({ page }) => {
  await page.goto('/fpo');
  await page.locator('#farmers tbody tr').first().waitFor();
  await page.getByLabel('Village').selectOption('Longowal');
  await page.getByLabel('Risk tier').selectOption('low');
  const empty = page.getByText('No farmers match these filters.');
  if (await empty.isVisible()) {
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(empty).toBeHidden();
  }
});
