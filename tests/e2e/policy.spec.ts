import { expect, test } from '@playwright/test';

test('CAQM: review the picture, scrub the plume, confirm and issue a GRAP-II alert', async ({ page }) => {
  await page.goto('/policy');

  await expect(page.getByRole('heading', { name: 'Source attribution matrix' })).toBeVisible();
  await expect(page.getByRole('table', { name: /Share of PM2.5 by source/ })).toContainText('36%'); // Delhi-NCR straw share
  await expect(page.getByText('39/40 online')).toBeVisible();

  // 72-hour scrubber
  const scrubber = page.getByRole('slider', { name: /Forecast hour/ });
  await scrubber.fill('14');
  await expect(page.getByText(/\+14 h ·/)).toBeVisible();
  await expect(page.locator('#plume').getByRole('row', { name: /Anand Vihar/ })).toContainText('+12 h');

  // selecting a street on the plume table drives the attribution cell
  await page.getByRole('button', { name: 'Rohini', exact: true }).first().click();
  await expect(page.getByLabel('Grid cell')).toHaveValue('rohini');

  // nothing is sent until the modal is confirmed
  await page.getByRole('button', { name: /Issue GRAP-II alert/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Affected area (5)')).toBeVisible();
  await expect(dialog.getByText('Delhi (all 11 districts)')).toBeVisible();
  await expect(page.getByText('No directive sent this session.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Send directive' }).click();
  await expect(page.getByText(/Issue GRAP-II alert: queued \(DIR-/)).toBeVisible();
  await expect(page.getByText(/Last: grap ii queued/)).toBeVisible();
});

test('CAQM: cancelling the modal sends nothing', async ({ page }) => {
  await page.goto('/policy');
  await page.getByRole('button', { name: /Deploy fog cannons/ }).click();
  await expect(page.getByRole('dialog').getByText('Anand Vihar ISBT corridor')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('No directive sent this session.')).toBeVisible();
});

test('CAQM: shows a retryable error state', async ({ page }) => {
  await page.goto('/policy?mock=error');
  await expect(page.getByRole('alert').first()).toContainText('could not load');
  await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible();
});
