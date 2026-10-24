import { expect, test } from '@playwright/test';

test.describe('Punjab locale', () => {
  test.use({ locale: 'pa-IN' });
  test('opens in Punjabi and a key press confirms the booking in Punjabi', async ({ page }) => {
    await page.goto('/farmer');
    const answer = page.getByTestId('answer');
    await expect(answer).toHaveText('ਚੁੱਕੋ');
    await answer.click();
    await expect(page.getByTestId('subtitle')).toContainText('ਸਤ ਸ੍ਰੀ ਅਕਾਲ');
    await page.getByRole('button', { name: /^1 ਦਬਾਓ: ਮਸ਼ੀਨ/ }).click();
    await expect(page.getByTestId('keypad-status')).toContainText('ਪੱਕਾ ਕਰਨ ਲਈ 1 ਦਬਾਓ');
    await page.getByRole('button', { name: /^1 ਦਬਾਓ: ਹਾਂ, ਪੱਕਾ ਕਰੋ/ }).click();
    await expect(page.getByTestId('keypad-status')).toContainText('ਤੁਹਾਡੀ ਮਸ਼ੀਨ ਬੁੱਕ ਹੈ');
  });
});

test.describe('English', () => {
  test.use({ locale: 'en-IN' });
  test('answer the call, hear the offer, book a Super Seeder with 1 and confirm with 1', async ({ page }) => {
    await page.goto('/farmer');
    await expect(page.getByText('Sangrur Kisan Society')).toBeVisible();
    await page.getByTestId('answer').click();

    // live call: timer runs, subtitles advance
    await expect(page.getByTestId('timer')).toHaveText('00:00');
    await expect(page.getByTestId('subtitle')).toContainText('Sat Sri Akal, Gurpreet ji');
    await expect(page.getByTestId('timer')).not.toHaveText('00:00', { timeout: 5000 });
    await expect(page.getByTestId('subtitle')).not.toContainText('Sat Sri Akal, Gurpreet ji', { timeout: 8000 });

    // play / pause control
    await page.getByTestId('play-pause').click();
    await expect(page.getByTestId('waveform')).toHaveAttribute('data-playing', 'false');

    // keypad: choose, then confirm. No WhatsApp step anywhere.
    await page.getByRole('button', { name: /Press 1: Book the machine/ }).click();
    await expect(page.getByTestId('confirm-step')).toContainText('You chose: Book the machine');
    await page.getByRole('button', { name: /Press 1: Yes, confirm/ }).click();
    await expect(page.getByTestId('keypad-status')).toContainText('Your machine is booked');
    await expect(page.getByText(/WhatsApp/i)).toHaveCount(0);
    await expect(page.getByTestId('keypad-status')).toContainText(/BK-/);
  });

  test('0 goes back to the menu; 9 reaches an FPO worker', async ({ page }) => {
    await page.goto('/farmer');
    await page.getByTestId('answer').click();
    await page.getByRole('button', { name: /Press 2: Pick up my straw/ }).click();
    await page.getByRole('button', { name: /Press 0: Go back/ }).click();
    await expect(page.getByTestId('keypad-status')).toContainText('No problem. Choose again');
    await page.getByRole('button', { name: /Press 9: Talk to an FPO worker/ }).click();
    await page.getByRole('button', { name: /Press 1: Yes, confirm/ }).click();
    await expect(page.getByTestId('keypad-status')).toContainText('connecting you to an FPO worker');
  });

  test('switching language mid-call keeps the call going', async ({ page }) => {
    await page.goto('/farmer');
    await page.getByTestId('answer').click();
    await page.getByRole('button', { name: 'हिंदी' }).click();
    await expect(page.getByTestId('subtitle')).toContainText('सत श्री अकाल', { timeout: 5000 });
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
