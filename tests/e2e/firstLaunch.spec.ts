import { test, expect } from '@playwright/test';

// A real first launch (no stored settings, no test preset) starts in English, even with a Slovak browser.
test.use({ locale: 'sk-SK' });

test('a first launch shows the English menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('menu-new')).toHaveText('New game', { timeout: 30_000 });
  await expect(page.getByText(/nová hra/i)).toHaveCount(0);
});
