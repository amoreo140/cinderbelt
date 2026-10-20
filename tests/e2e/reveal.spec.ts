import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// Progressive reveal (Stage 3): during the Guild Training the HUD parts and the station tabs appear step
// by step; a skipped training (and an old save) shows everything.
// Screenshots: test-results-stage3-shots/reveal-*.png

const OUT = 'test-results-stage3-shots';

async function newTrainingGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('new-game')).toBeVisible();
  await page.getByTestId('preset-standard').click();
  await page.getByTestId('seed-input').fill('reveal-1');
  const training = page.getByTestId('ng-training');
  await expect(training).toBeVisible();
  await training.getByRole('button', { name: 'Hrať výcvik' }).click();
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 120_000 });
}

async function undock(page: Page): Promise<void> {
  await page.getByTestId('undock').click({ timeout: 20_000 });
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', null, { timeout: 30_000 });
}

test('a new training game starts with a small HUD and locked tabs', async ({ page }) => {
  test.setTimeout(240_000);
  await newTrainingGame(page);
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await expect(page.getByTestId('tab-board')).toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('tab-board')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('tab-archive')).toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('tab-overview')).not.toHaveAttribute('data-locked', 'true');
  await undock(page);
  await expect(page.locator('.hud')).toBeVisible();
  await expect(page.locator('.hud-radar')).toHaveCount(0);
  await expect(page.getByTestId('hud-credits')).toHaveCount(0);
  await expect(page.locator('.af-gauge--fuel')).toBeVisible();
  await expect(page.locator('.hud-dampers')).toHaveCount(0);
  await expect(page.locator('.hud-nav')).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/reveal-01-step1-flight.png` });
});

test('mid training: unlocked tabs open, locked ones ignore click and digit key', async ({ page }) => {
  await loadFixture(page, 'training-mid');
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await expect(page.getByTestId('tab-shipyard')).not.toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('tab-crafting')).toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('tab-board')).toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('open-board')).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/reveal-02-training-mid-tabs.png` });
  // the board's digit key and a click on the locked tab do nothing
  await page.keyboard.press('Digit6');
  await page.getByTestId('tab-board').click({ force: true });
  await page.keyboard.press('Digit3');
  const tab = () => page.evaluate(() => (window.__cinder!.game as unknown as { stationUi: { tab: string } }).stationUi.tab);
  expect(await tab()).toBe('overview');
  await page.keyboard.press('Digit4');
  await expect.poll(tab).toBe('shipyard');
});

test('a skipped training shows everything', async ({ page }) => {
  await loadFixture(page, 'start');
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await expect(page.locator('[data-locked="true"]')).toHaveCount(0);
  await undock(page);
  await expect(page.locator('.hud-radar')).toBeVisible();
  await expect(page.getByTestId('hud-credits')).toBeVisible();
});
