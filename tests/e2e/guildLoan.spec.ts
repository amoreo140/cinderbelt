import { expect, test } from './test';
import type { Page } from '@playwright/test';

// Guild loan (saboteur fixes): a broke player without a laser docked at a shipyard gets a T1 laser lent
// by the Guild – mounted on the hull for free, announced by a toast, shown in the shipyard as a loan
// badge with its explanation. Screenshots go to the Playwright output folder (--output).

type GridModule = typeof import('../../src/sim/ship/grid');
type PropertiesModule = typeof import('../../src/sim/ship/properties');
const MODULES = { grid: '/src/sim/ship/grid.ts', properties: '/src/sim/ship/properties.ts' } as const;

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/${name}.png` });

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('Guild loan: a broke laserless player gets a lent laser on the hull, the shipyard shows the loan badge', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await expect(page.getByTestId('station-hub')).toBeVisible();

  // the player sold everything: cockpit, a hold and one engine left, no credits, an empty storage
  await page.evaluate(async (modules) => {
    const { computeProperties } = (await import(/* @vite-ignore */ modules.properties)) as PropertiesModule;
    const { createGrid } = (await import(/* @vite-ignore */ modules.grid)) as GridModule;
    const { sim } = window.__cinder!;
    const s = sim.state;
    s.credits = 0;
    s.stations.get('home')!.parts = {};
    const grid = createGrid([
      ['cockpit', 1, 0],
      ['cargo', 0, 0],
      ['engine', -1, 0, 0],
    ]);
    s.player.grid = grid;
    s.player.blueprint = grid;
    s.player.props = computeProperties(grid);
    s.player.gridVersion++;
  }, MODULES);
  await page.waitForFunction(() => window.__cinder!.sim.state.player.grid.parts.some((p) => p.loan));
  await expect(page.getByTestId('toast')).toContainText('Výpožička Cechu');
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(0);
  await shot(page, 'guild-loan-toast');

  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  const band = page.getByTestId('yard-loan-band');
  await expect(band).toBeVisible();
  await expect(band).toContainText('Výpožička Cechu');
  await expect(band).toContainText('nedá sa predať');
  await page.getByTestId('yard-loan-show').click();
  await page.waitForTimeout(500);
  await shot(page, 'guild-loan-shipyard');
  expect(errors).toEqual([]);
});
