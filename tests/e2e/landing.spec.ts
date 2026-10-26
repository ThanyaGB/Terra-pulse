import { expect, test } from '@playwright/test';

test('landing: scroll story renders, links reach the five prototypes, judge tour steps through', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await page.mouse.wheel(0, 3000);
  await expect(page.locator('.lp-stage')).toBeVisible();
  await page.getByRole('link', { name: /Start judge demo mode/ }).click();
  await expect(page).toHaveURL(/\/fpo\?tour=1/);
  const tour = page.getByRole('complementary', { name: 'Judge demo tour' });
  await expect(tour).toContainText('TOUR 1/5');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/farmer\?tour=2/);
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/citizen\?tour=3/);
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/policy\?tour=4/);
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/ops\?tour=5/);
  await expect(tour.getByRole('link', { name: 'Finish' })).toBeVisible();
});

test('judge tour panel minimises, moves, and stays minimised across steps', async ({ page }) => {
  await page.goto('/fpo?tour=1');
  const tour = page.getByRole('complementary', { name: 'Judge demo tour' });
  await tour.getByRole('button', { name: 'Minimise the tour panel' }).click();
  await expect(tour.getByRole('button', { name: 'Expand the tour panel' })).toBeVisible();
  const handle = tour.getByRole('button', { name: /Move the tour panel/ });
  const before = await tour.boundingBox();
  const hb = await handle.boundingBox();
  if (!before || !hb) throw new Error('tour panel not laid out');
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 200, hb.y - 200, { steps: 5 });
  await page.mouse.up();
  const after = await tour.boundingBox();
  expect(after && after.x).toBeLessThan(before.x);
  await tour.getByRole('button', { name: 'Next tour step' }).click();
  await expect(page).toHaveURL(/\/farmer\?tour=2/);
  await expect(tour.getByRole('button', { name: 'Expand the tour panel' })).toBeVisible();
  await tour.getByRole('button', { name: 'Expand the tour panel' }).click();
  await expect(tour).toContainText('Farmer call');
});

test('GRAP-II issued on /policy shows the banner on /citizen and the order in the log', async ({ page }) => {
  await page.goto('/policy');
  await page.getByRole('button', { name: /Issue GRAP-II alert/ }).click();
  await page.getByRole('button', { name: 'Send directive' }).click();
  await expect(page.getByRole('region', { name: 'Administrative orders' }).or(page.locator('#orders'))).toContainText('GRAP');
  await page.goto('/citizen');
  await expect(page.getByRole('status').filter({ hasText: 'GRAP Stage II' })).toBeVisible();
});
