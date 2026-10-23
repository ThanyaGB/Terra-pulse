import { expect, test } from '@playwright/test';

test.use({ locale: 'en-IN', permissions: ['geolocation'], geolocation: { latitude: 28.6469, longitude: 77.3152 } });

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('Citizen: read the air, get advice for a profile, plan a cleaner commute, report a problem', async ({ page }) => {
  await page.goto('/citizen');

  // community AQI card
  await expect(page.getByTestId('area-name')).toHaveText('Anand Vihar, Colony 204');
  await expect(page.getByTestId('aqi-value')).toHaveText(/^\d{3}$/);
  await expect(page.getByTestId('aqi-band')).toBeVisible();
  await expect(page.getByTestId('pm25-value')).toContainText('µg/m³');
  await expect(page.getByText('Upstream straw plume')).toBeVisible();

  // advice follows the profile and the time of day
  await page.getByLabel('Time of day').selectOption({ label: '07:00' });
  await page.getByText('Asthma / chronic respiratory').click();
  await expect(page.getByTestId('advice')).toContainText('Skip outdoor exercise until 10:30');
  await page.getByText('Outdoor worker').click();
  await expect(page.getByTestId('advice')).toContainText('Wear an N95 during shifts');
  await page.getByLabel('Time of day').selectOption({ label: '13:45' });
  await expect(page.getByTestId('advice')).toContainText('Best window of the day');
  await expect(page.getByText('Ventilation window').locator('xpath=ancestor::li')).toHaveAttribute('data-state', 'active');

  // neighbourhood switch
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByText('Patparganj, Mayur Vihar Ph-1').click();
  await expect(page.getByTestId('area-name')).toHaveText('Patparganj, Mayur Vihar Ph-1');

  // clean commute
  await page.getByRole('button', { name: 'Clean route', exact: true }).click();
  await page.getByRole('button', { name: 'Find a cleaner route' }).click();
  await expect(page.getByText('Enter a start and a different destination.')).toBeVisible();
  await page.getByLabel('Start').fill('Anand Vihar Metro');
  await page.getByLabel('Destination').fill('Patparganj Depot');
  await page.getByRole('button', { name: 'Find a cleaner route' }).click();
  const cards = page.getByTestId('route-card');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('[data-recommended="true"]')).toContainText('Route B');
  await expect(page.locator('[data-recommended="true"]')).toContainText('Recommended');
  await expect(page.getByTestId('reduction')).toHaveText('32% less exposure');

  // snap and report
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose a category and take a photo first.');
  await page.getByText('Open waste burning').click();
  await page.getByTestId('photo-input').setInputFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('gps-status')).toContainText('Location attached');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Report received')).toBeVisible();
  await expect(page.getByTestId('reference-id')).toHaveText(/^VS-R-\d+$/);
});

test('Citizen: works at 360 px and is installable (manifest + service worker file)', async ({ page, request }) => {
  await page.goto('/citizen');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/citizen');
  expect((await request.get('/sw.js')).ok()).toBe(true);
});

test('Citizen: offline shows the last saved reading', async ({ page, context }) => {
  await page.goto('/citizen');
  await expect(page.getByTestId('aqi-value')).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText('You are offline. Showing saved data.')).toBeVisible();
  await expect(page.getByTestId('aqi-value')).toBeVisible();
});
