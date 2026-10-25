import { expect, test } from '@playwright/test';

test.use({ locale: 'en-IN', permissions: ['geolocation'], geolocation: { latitude: 28.6469, longitude: 77.3159 } });

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('GRAP-II on /policy creates work orders; a supervisor accepts and completes one with photo and GPS', async ({ page }) => {
  await page.goto('/policy');
  await page.getByRole('button', { name: /Issue GRAP-II alert/ }).click();
  await page.getByRole('button', { name: 'Send directive' }).click();
  await expect(page.getByTestId('order-progress').first()).toContainText('3 work orders · 0 done');

  await page.getByTestId('order-progress').first().click();
  await expect(page).toHaveURL(/\/ops$/);
  const fromGrap = page.getByTestId('work-order').filter({ has: page.getByTestId('order-source').filter({ hasText: 'GRAP-II alert' }) });
  await expect(fromGrap).toHaveCount(3);

  const first = fromGrap.first();
  const id = await first.getAttribute('data-id');
  await first.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByTestId('ops-note')).toContainText(`${id} accepted`);
  const card = page.locator(`[data-testid="work-order"][data-id="${id}"]`);
  await card.getByRole('button', { name: 'Complete' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('ops-photo-input').setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog.getByTestId('ops-gps')).toContainText('Location attached');
  await dialog.getByRole('button', { name: 'Send completion' }).click();
  await expect(page.getByTestId('ops-note')).toContainText('Completion sent');
  await expect(page.locator(`[data-testid="work-order"][data-id="${id}"]`)).toHaveAttribute('data-status', 'completed');

  await page.goto('/policy');
  await expect(page.getByTestId('order-progress').first()).toContainText('3 work orders · 1 done');
});

test('demo photo and demo location work when there is no camera or location permission', async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto('/ops');
  await page.getByRole('tab', { name: /In progress/ }).click();
  await page.getByTestId('work-order').first().getByRole('button', { name: 'Complete' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Send completion' }).click();
  await expect(dialog.getByRole('alert')).toContainText('A photo and your location are both needed');
  await dialog.getByRole('button', { name: 'Use a demo photo' }).click();
  await dialog.getByRole('button', { name: 'Use demo location' }).click();
  await expect(dialog.getByTestId('ops-gps')).toContainText('Demo location attached');
  await dialog.getByRole('button', { name: 'Send completion' }).click();
  await expect(page.getByTestId('ops-note')).toContainText('Completion sent');
});
