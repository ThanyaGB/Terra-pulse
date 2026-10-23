import { expect, test } from '@playwright/test';

test('landing: scroll story renders, links reach the four prototypes, judge tour steps through', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await page.mouse.wheel(0, 3000);
  await expect(page.locator('.lp-stage')).toBeVisible();
  await page.getByRole('link', { name: /Start judge demo mode/ }).click();
  await expect(page).toHaveURL(/\/policy\?tour=1/);
  const tour = page.getByRole('complementary', { name: 'Judge demo tour' });
  await expect(tour).toContainText('TOUR 1/4');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/fpo\?tour=2/);
  await tour.getByRole('button', { name: 'Next' }).click();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/citizen\?tour=4/);
  await expect(tour.getByRole('link', { name: 'Finish' })).toBeVisible();
});

test('GRAP-II issued on /policy shows the banner on /citizen and the order in the log', async ({ page }) => {
  await page.goto('/policy');
  await page.getByRole('button', { name: /Issue GRAP-II alert/ }).click();
  await page.getByRole('button', { name: 'Send directive' }).click();
  await expect(page.getByRole('region', { name: 'Administrative orders' }).or(page.locator('#orders'))).toContainText('GRAP');
  await page.goto('/citizen');
  await expect(page.getByRole('status').filter({ hasText: 'GRAP Stage II' })).toBeVisible();
});
