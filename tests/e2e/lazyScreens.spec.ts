import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// Lazily loaded screens (audit 2026-10-17, P6/P10 – src/ui/lazy.ts, lazyScreens.ts): the shipyard editor,
// the hangar, the templates, Development, the Board and the map are chunks of their own, fetched in an
// idle moment once the hub (or the flight HUD) is up. Opened right after the game loads, each one shows,
// and no page error happens on the way.

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('the docked screens open right after the game loads', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  // docked at home (a hangar slot, templates, the Development tab), no extra ticks after the load
  await loadFixture(page, 'hangar', { ticks: 0 });
  await page.getByTestId('tab-shipyard').click();
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await expect(page.getByTestId('yard-ship')).toBeVisible();
  await expect(page.getByTestId('yard-commit')).toBeVisible();
  await page.getByTestId('yard-open-hangar').click();
  await expect(page.getByTestId('hangar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hangar')).toBeHidden();
  await page.getByTestId('yard-open-templates').click();
  await expect(page.getByTestId('templates')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('templates')).toBeHidden();
  await page.getByTestId('tab-development').click();
  await expect(page.getByTestId('development')).toBeVisible();
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('board')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the map opens right after the undock', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'hour2', { ticks: 0 });
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
