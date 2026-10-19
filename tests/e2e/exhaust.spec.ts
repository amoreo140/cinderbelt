import { expect, test } from './test';
import type { Page } from '@playwright/test';

// A covered engine nozzle (design 3.4.2, functional from M3): the shipyard warns about the real
// penalty and the V layer marks the nozzle and the burnt cell; in flight the part burns and a toast says so.
// Screenshots go to the Playwright output folder (--output).

const MODULES = { grid: '/src/sim/ship/grid.ts', properties: '/src/sim/ship/properties.ts' } as const;
type GridModule = typeof import('../../src/sim/ship/grid');
type PropertiesModule = typeof import('../../src/sim/ship/properties');

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/${name}.png` });

/** The starter ship with armour right behind the left forward engine's nozzle (x = −2, y = 1). */
async function coverNozzle(page: Page): Promise<void> {
  await page.evaluate(async (modules) => {
    const { createGrid } = (await import(/* @vite-ignore */ modules.grid)) as GridModule;
    const { computeProperties } = (await import(/* @vite-ignore */ modules.properties)) as PropertiesModule;
    const player = window.__cinder!.sim.state.player;
    const grid = createGrid([
      ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
      ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
      ['engine', 0, -2, 1], ['engine', 0, 2, 3], ['armor', -2, 1],
    ]);
    const props = computeProperties(grid);
    player.grid = grid;
    player.blueprint = grid;
    player.props = props;
    player.gridVersion++;
    player.hp = new Map();
    player.fuel = props.fuelCapacity;
  }, MODULES);
}

test('M3: a covered nozzle – shipyard warning and V layer, burning in flight with a toast', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await coverNozzle(page);
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.props.exhaustBurns.length)).toBe(1);

  // shipyard: the warning names the real penalty, the V layer (on by default) marks the nozzle
  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('yard-view')).toBeVisible();
  await expect(page.getByText(/polovičný ťah/).first()).toBeVisible();
  await page.mouse.move(640, 650);
  await page.waitForTimeout(500);
  await shot(page, 'exhaust-shipyard');
  await page.keyboard.press('Escape');

  // flight: full forward thrust burns the armour and a toast says so
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', undefined, { timeout: 30_000 });
  await page.keyboard.down('KeyW');
  await expect(page.getByTestId('toast')).toContainText('Tryska motora páli diel', { timeout: 20_000 });
  await shot(page, 'exhaust-flight-toast');
  await page.keyboard.up('KeyW');
  const hp = await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    const armor = p.grid.parts.find((x) => x.partId === 'armor')!;
    return p.hp.get(armor.id) ?? null;
  });
  expect(hp).not.toBeNull();
  expect(hp!).toBeLessThan(40);
  expect(errors).toEqual([]);
});
