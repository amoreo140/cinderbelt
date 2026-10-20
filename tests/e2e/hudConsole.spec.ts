import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// Stage 4: the calm flight HUD – three thin bars always, the other console rows only when the situation asks
// (src/ui/consoleRules.ts), the one-line location, the radar legend on demand ("?") and the K chip bottom right.
// Screenshots: test-results-task13/hudconsole-*.png

const OUT = 'test-results-task13';

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, selector).not.toBeNull();
  return b!;
};

test('quiet flight: only hull, fuel and energy; rows appear with the situation', async ({ page }) => {
  test.setTimeout(180_000);
  await loadFixture(page, 'rich-rock');
  // the three bars, thin and compact
  await expect(page.getByTestId('gauge-hull')).toBeVisible();
  await expect(page.locator('.af-gauge--fuel')).toBeVisible();
  await expect(page.locator('.af-gauge--energy')).toBeVisible();
  const console = await box(page, '.hud-console');
  expect(console.width).toBeLessThanOrEqual(330);
  // nothing else: no speed, no silhouette / shield, no cargo row, no dampers warning
  await expect(page.getByTestId('hud-speed')).toHaveCount(0);
  await expect(page.getByTestId('ship-status')).toHaveCount(0);
  await expect(page.getByTestId('gauge-shield')).toHaveCount(0);
  await expect(page.locator('.af-gauge--cargo')).toHaveCount(0);
  await expect(page.locator('.hud-dampers')).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/hudconsole-quiet.png` });

  // the dampers OFF: a warning row with the Z key
  await page.keyboard.press('KeyZ');
  await expect(page.locator('.hud-dampers')).toBeVisible();
  await expect(page.locator('.hud-dampers')).toContainText('VYP');
  await page.keyboard.press('KeyZ');
  await expect(page.locator('.hud-dampers')).toHaveCount(0);

  // mining: the cargo row and the laser heat on top of the console
  const p = await page.evaluate(() => window.__cinder!.renderer.worldToScreen(window.__cinder!.sim.state.world.findAsteroid('0,-1:3')!.pos));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: 'right' });
  await expect(page.locator('.af-gauge--cargo')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('hud-heat')).toBeVisible();
  await page.screenshot({ path: `${OUT}/hudconsole-mining.png` });
  await page.mouse.up({ button: 'right' });
});

test('dock approach: the speed row; combat: the silhouette and the shield', async ({ page }) => {
  test.setTimeout(180_000);
  await loadFixture(page, 'dock-approach');
  await expect(page.getByTestId('hud-speed')).toBeVisible();
  await expect(page.getByTestId('ship-status')).toHaveCount(0);
  await loadFixture(page, 'pirates-near');
  await expect(page.getByTestId('ship-status')).toBeVisible();
  await expect(page.getByTestId('gauge-shield')).toBeVisible();
  await expect(page.getByTestId('hud-speed')).toHaveCount(0);
});

test('location is one line: sector and security; no position / station rows', async ({ page }) => {
  test.setTimeout(180_000);
  await loadFixture(page, 'rich-rock');
  const nav = page.locator('.hud-nav');
  await expect(nav).toContainText('Počiatok');
  await expect(nav).toContainText('Strážený');
  await expect(nav.locator('dl')).toHaveCount(0);
  const b = await box(page, '[data-testid="sector-badge"]');
  expect(b.height).toBeLessThan(32);
});

test('radar legend on demand: held "?" pins it, no longer open with the help; the K chip sits above the scanner', async ({ page }) => {
  test.setTimeout(180_000);
  await loadFixture(page, 'dock-approach');
  await expect(page.getByTestId('radar-legend-help')).toHaveCount(0);
  await expect(page.getByTestId('radar-legend-hover')).toBeHidden();
  // the small "?" keycap on the radar corner
  await expect(page.locator('.hud-radar-key')).toBeVisible();
  await page.keyboard.down('Shift');
  await page.keyboard.down('Slash');
  await expect(page.getByTestId('radar-legend-help')).toBeVisible();
  await page.screenshot({ path: `${OUT}/hudconsole-legend.png` });
  await page.keyboard.up('Slash');
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('radar-legend-help')).toHaveCount(0);
  // the help (K) open: the legend stays closed
  await page.keyboard.press('KeyK');
  await expect(page.locator('.hud-help:not(.is-collapsed)')).toBeVisible();
  await expect(page.getByTestId('radar-legend-help')).toHaveCount(0);
  await page.keyboard.press('KeyK');
  // the collapsed K chip: bottom right, directly above the scanner chip
  const chip = await box(page, '.hud-help.is-collapsed');
  const scan = await box(page, '.ds-scan');
  const view = page.viewportSize()!;
  expect(chip.y + chip.height).toBeLessThanOrEqual(scan.y);
  expect(chip.x + chip.width).toBeGreaterThan(view.width / 2);
  expect(chip.y).toBeGreaterThan(view.height / 2);
});
