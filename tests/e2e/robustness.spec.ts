import { expect, test } from './test';
import { loadFixture } from './fixtures';
import type { Page } from '@playwright/test';

// Failures that must not end in a blank page or a stuck slot (issue #3).

async function startSavedGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('preset-calm').click();
  await page.getByTestId('seed-input').fill('robust-test-1');
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 60_000 });
}

test.describe('boot', () => {
  test.use({ firstLaunchLanguage: 'en' });

  test('no language loads: the boot error card with Reload', async ({ page }) => {
    test.setTimeout(90_000);
    await page.route('**/src/i18n/texts*.ts*', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByTestId('boot-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('boot-error')).toContainText('The game did not start');
    await page.screenshot({ path: 'test-results/boot-error-1280.png' });
    await page.unroute('**/src/i18n/texts*.ts*');
    // page.click() would wait for the reload navigation it starts
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid=boot-reload]')!.click());
    await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  });

  test('the wanted language does not load: another one is used', async ({ page }) => {
    await page.route('**/src/i18n/textsEn.ts*', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('boot-error')).toHaveCount(0);
  });
});

test.describe('lazy screens', () => {
  test.use({ firstLaunchLanguage: 'en' });

  test('a screen chunk that fails shows Retry and loads on the second try', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/station/Shipyard.tsx*', (route) => route.abort());
    await loadFixture(page, 'start');
    await page.getByTestId('tab-shipyard').click();
    await expect(page.getByTestId('lazy-failed').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/lazy-failed-1280.png' });
    await page.unroute('**/station/Shipyard.tsx*');
    await page.getByTestId('lazy-retry').first().click();
    await expect(page.getByTestId('shipyard')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('lazy-failed')).toHaveCount(0);
  });
});

test.describe('slot lock', () => {
  test.use({ firstLaunchLanguage: 'en' });

  test('a launch that throws frees the slot: Continue works afterwards', async ({ page }) => {
    test.setTimeout(120_000);
    await startSavedGame(page);
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-quit').click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await page.evaluate(() => {
      const app = (window as unknown as { __cinderApp: Record<string, any> }).__cinderApp;
      const real = app.launch;
      app.launch = () => {
        app.launch = real;
        throw new Error('injected launch failure');
      };
    });
    await page.getByTestId('menu-continue').click();
    await expect(page.getByTestId('main-menu')).toContainText('could not be started');
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await page.screenshot({ path: 'test-results/launch-failed-1280.png' });
    // the slot is not "open in another tab": loading it works
    await page.getByTestId('menu-continue').click();
    await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 60_000 });
  });
});
