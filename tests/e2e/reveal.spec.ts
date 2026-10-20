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
  // K (help) is never gated
  await expect(page.locator('.hud-help')).toHaveClass(/is-collapsed/);
  await page.keyboard.press('KeyK');
  await expect(page.locator('.hud-help')).not.toHaveClass(/is-collapsed/);
  await page.keyboard.press('KeyK');
  await expect(page.locator('.hud-help')).toHaveClass(/is-collapsed/);
  // M (map) is locked until the checklist step: the key does nothing
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window.__cinder!.game as unknown as { mapOpen: boolean }).mapOpen)).toBe(false);

  // everything unlocks at once (the last step): the new parts are outlined but stay in their places
  const rect = (sel: string) => page.locator(sel).evaluate((el) => { const b = el.getBoundingClientRect(); return { r: Math.round(window.innerWidth - b.right), b: Math.round(window.innerHeight - b.bottom) }; });
  await page.evaluate(() => {
    window.__cinder!.sim.state.career.training.step = 8;
  });
  await expect(page.locator('.hud-radar')).toHaveClass(/is-new/);
  await expect(page.locator('.ds-scan')).toHaveClass(/is-new/);
  const radar = await rect('.hud-radar');
  expect(radar.r).toBeLessThan(40);
  expect(radar.b).toBeLessThan(40);
  const scan = await rect('.ds-scan');
  await page.screenshot({ path: `${OUT}/reveal-03-badges.png` });
  // the highlight ends after a few seconds
  await expect(page.locator('.hud-radar')).not.toHaveClass(/is-new/, { timeout: 15_000 });
  // ... and nothing moved because of it
  expect(await rect('.hud-radar')).toEqual(radar);
  expect(await rect('.ds-scan')).toEqual(scan);
});

test('mid training: unlocked tabs open, locked ones ignore click and digit key', async ({ page }) => {
  await loadFixture(page, 'training-mid');
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await expect(page.getByTestId('tab-shipyard')).not.toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('tab-crafting')).toHaveCount(0);
  await expect(page.getByTestId('tab-service')).toHaveCount(0);
  await expect(page.getByTestId('tab-board')).toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('open-board')).toHaveCount(0);
  await page.getByTestId('tab-board').hover();
  await expect(page.getByText('Odomkne sa po výcviku Cechu')).toBeVisible();
  await page.screenshot({ path: `${OUT}/reveal-02-training-mid-tabs.png` });
  // the board's digit key and a click on the locked tab do nothing
  await page.keyboard.press('Digit4');
  await page.getByTestId('tab-board').click({ force: true });
  await page.keyboard.press('Digit5');
  const tab = () => page.evaluate(() => (window.__cinder!.game as unknown as { stationUi: { tab: string } }).stationUi.tab);
  expect(await tab()).toBe('overview');
  await page.keyboard.press('Digit3');
  await expect.poll(tab).toBe('shipyard');
  // crafting is a Market view: locked until step 7, with the reason on hover
  // in the editor the digit keys pick parts: use the tab
  await page.getByTestId('tab-market').click();
  await expect.poll(tab).toBe('market');
  const craft = page.getByTestId('market-view-craft');
  await expect(craft).toHaveAttribute('data-locked', 'true');
  await craft.hover();
  await expect(page.getByText('Odomkne sa v kroku 7 výcviku Cechu')).toBeVisible();
  await craft.click({ force: true });
  await expect(page.getByTestId('craft-detail')).toHaveCount(0);
});

test('a skipped training shows everything', async ({ page }) => {
  await loadFixture(page, 'start');
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await expect(page.locator('[data-locked="true"]')).toHaveCount(0);
  await undock(page);
  await expect(page.locator('.hud-radar')).toBeVisible();
  await expect(page.getByTestId('hud-credits')).toBeVisible();
});
