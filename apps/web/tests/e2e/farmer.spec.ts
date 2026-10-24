import { expect, test } from '@playwright/test';

test.describe('Punjab locale', () => {
  test.use({ locale: 'pa-IN' });
  test('opens in Punjabi and a key press confirms the booking in Punjabi', async ({ page }) => {
    await page.goto('/farmer');
    const answer = page.getByTestId('answer');
    await expect(answer).toHaveText('ਚੁੱਕੋ');
    await answer.click();
    await expect(page.getByTestId('subtitle')).toContainText('ਸਤ ਸ੍ਰੀ ਅਕਾਲ');
    await page.getByRole('button', { name: /^1 ਦਬਾਓ: ਸੁਪਰ ਸੀਡਰ/ }).click();
    await expect(page.getByTestId('keypad-status')).toContainText('ਪੱਕਾ ਕਰਨ ਲਈ 1 ਦਬਾਓ');
    await page.getByRole('button', { name: /^1 ਦਬਾਓ: ਹਾਂ, ਪੱਕਾ ਕਰੋ/ }).click();
    await expect(page.getByTestId('keypad-status')).toContainText('ਹੋ ਗਿਆ! ਸੁਪਰ ਸੀਡਰ ਤੁਹਾਡੇ ਲਈ ਪੱਕਾ ਹੈ।');
  });
});

test.describe('English', () => {
  test.use({ locale: 'en-IN' });
  test('answer the call, hear the offer, lock a Super Seeder with key 1', async ({ page }) => {
    await page.goto('/farmer');
    await expect(page.getByText('Sangrur Machinery Cooperative')).toBeVisible();
    await page.getByTestId('answer').click();

    // live call: timer runs, subtitles advance, prices are visible
    await expect(page.getByTestId('timer')).toHaveText('00:00');
    await expect(page.getByTestId('subtitle')).toContainText('Hello Gurpreet ji');
    await expect(page.getByTestId('timer')).not.toHaveText('00:00', { timeout: 5000 });
    const prices = page.getByRole('group', { name: 'Prices' });
    await expect(prices.getByText('₹750')).toBeVisible();
    await expect(prices.getByText('₹1,650')).toBeVisible();
    await expect(page.getByTestId('subtitle')).not.toContainText('Hello Gurpreet ji', { timeout: 8000 });

    // play / pause control
    await page.getByTestId('play-pause').click();
    await expect(page.getByTestId('waveform')).toHaveAttribute('data-playing', 'false');

    // keypad: choose, then confirm with 1. No WhatsApp step anywhere.
    await page.getByRole('button', { name: /Press 1: Lock Super Seeder/ }).click();
    await expect(page.getByTestId('confirm-step')).toContainText('You chose: Lock Super Seeder');
    await page.getByRole('button', { name: /Press 1: Yes, confirm/ }).click();
    await expect(page.getByText(/WhatsApp/i)).toHaveCount(0);
    await expect(page.getByTestId('keypad-status')).toContainText('Done! Super Seeder is locked for you.');
    await expect(page.getByTestId('keypad-status')).toContainText(/BK-/);
  });

  test('switching language mid-call keeps the call going', async ({ page }) => {
    await page.goto('/farmer');
    await page.getByTestId('answer').click();
    await page.getByRole('button', { name: 'हिंदी' }).click();
    await expect(page.getByTestId('subtitle')).toContainText('नमस्ते', { timeout: 5000 });
    await expect(page.getByRole('button', { name: /1 दबाएँ/ })).toBeVisible();
  });

  test('is usable at 360 px without horizontal scrolling', async ({ page }) => {
    await page.goto('/farmer');
    await page.getByTestId('answer').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const k of ['1', '2', '9']) {
      const box = await page.getByRole('button', { name: new RegExp(`Press ${k}:`) }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(56);
    }
  });
});
