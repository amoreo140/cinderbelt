// Language (i18n phase 1): a first launch is English whatever the browser says, the menu and Settings switch it live and
// the choice survives a reload. English modules not translated yet fall back to Slovak, so the checks use
// texts that already exist in English (the graphics setting) and the document language. Only the active
// language is loaded: a switch shows the other one once its texts are in (a moment – hence the polled
// checks right after a switch).
import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function openMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
}

const lang = (page: Page) => page.evaluate(() => document.documentElement.lang);

test('first launch: the browser language is ignored, every locale starts in English', async ({ browser }) => {
  // browser.newContext bypasses the ./test fixture (no Slovak preset), so these are real first launches
  for (const locale of ['en-US', 'cs-CZ', 'sk-SK']) {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    await openMenu(page);
    expect(await lang(page), locale).toBe('en');
    await expect(page.getByTestId('menu-language').getByRole('button', { pressed: true })).toHaveText('English');
    await context.close();
  }
});

test('the menu and Settings switch the language live and it survives a reload', async ({ page }, info) => {
  const errors = trackErrors(page);
  await openMenu(page);
  expect(await lang(page)).toBe('sk');
  await page.waitForTimeout(1600); // the menu's intro animation
  await page.screenshot({ path: info.outputPath('menu-sk.png') });

  await page.getByTestId('menu-language').getByRole('button', { name: 'English' }).click();
  await expect.poll(() => lang(page)).toBe('en');
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toContainText('Graphics quality');
  await expect(page.getByTestId('set-language').getByRole('button', { pressed: true })).toHaveText('English');
  await page.screenshot({ path: info.outputPath('settings-en.png') });

  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  expect(await lang(page)).toBe('en');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: info.outputPath('menu-en.png') });

  await page.getByTestId('menu-settings').click();
  await page.getByTestId('set-language').getByRole('button', { name: 'Slovenčina' }).click();
  await expect(page.getByTestId('settings')).toContainText('Kvalita grafiky');
  expect(await lang(page)).toBe('sk');
  await page.screenshot({ path: info.outputPath('settings-sk.png') });
  expect(errors).toEqual([]);
});

test('in game: the hub and the flight HUD run in English and switch back live', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ locale: 'en-GB' });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await page.goto('/?play');
  await expect(page.getByTestId('station-hub')).toBeVisible({ timeout: 30_000 });
  expect(await lang(page)).toBe('en');
  await page.waitForTimeout(600);
  await page.screenshot({ path: info.outputPath('hub-en.png') });

  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: info.outputPath('flight-en.png') });

  // live switch from the pause menu: the HUD under it follows on its next frame
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-settings').click();
  await page.getByTestId('set-language').getByRole('button', { name: 'Slovenčina' }).click();
  await expect.poll(() => lang(page)).toBe('sk');
  await expect(page.getByTestId('settings')).toContainText('Kvalita grafiky');
  expect(errors).toEqual([]);
  await context.close();
});

test('in game: a toast on screen says the same in the new language after a live switch', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'derelict');
  expect(await lang(page)).toBe('sk');
  // the micrometeor warning outside the Guild Watch's cover: the chip and a toast (no radio)
  await page.evaluate(() => window.__cinder!.events!.force('micrometeors'));
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('Spŕška mikrometeoritov', { timeout: 30_000 });
  // live switch from the pause menu (the game clock stands, the toast stays)
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-settings').click();
  await page.getByTestId('set-language').getByRole('button', { name: 'English' }).click();
  await expect.poll(() => lang(page)).toBe('en');
  await expect(toast).toContainText('Micrometeor shower', { timeout: 5_000 });
  expect(errors).toEqual([]);
});

test('German: the menu switches to German live, and the hub and flight HUD run in German', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openMenu(page);
  await page.getByTestId('menu-language').getByRole('button', { name: 'Deutsch' }).click();
  await expect.poll(() => lang(page)).toBe('de');
  await page.waitForTimeout(1600); // the menu's intro animation
  await page.screenshot({ path: info.outputPath('menu-de.png') });
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toContainText('Grafikqualität');
  await expect(page.getByTestId('set-language').getByRole('button', { pressed: true })).toHaveText('Deutsch');
  await page.screenshot({ path: info.outputPath('settings-de.png') });

  await page.goto('/?play');
  await expect(page.getByTestId('station-hub')).toBeVisible({ timeout: 30_000 });
  expect(await lang(page)).toBe('de');
  await page.waitForTimeout(600);
  await page.screenshot({ path: info.outputPath('hub-de.png') });
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: info.outputPath('flight-de.png') });
  expect(errors).toEqual([]);
});
