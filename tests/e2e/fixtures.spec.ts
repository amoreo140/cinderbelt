import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture, type FixtureName } from './fixtures';

// Every test save position boots straight into the game (`?fixture=<name>`) without errors: docked
// ones show the station hub, flying ones the flight HUD. A screenshot of each goes to the --output
// folder (a quick look at all the positions).

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

const DOCKED: FixtureName[] = ['start', 'training-mid', 'after-training', 'hour1', 'hour2', 'damaged', 'cargo-full', 'hangar'];
const FLYING: FixtureName[] = ['dock-approach', 'pirates-near', 'fortress', 'rich-rock', 'wreck-salvage', 'derelict', 'derelict-dock', 'graveyard', 'comet', 'gunner'];

test('test save positions: every fixture boots into the game', async ({ page }) => {
  test.setTimeout(540_000);
  const errors = collectErrors(page);
  for (const name of [...DOCKED, ...FLYING]) {
    await loadFixture(page, name, { ticks: 30 });
    const mode = await page.evaluate(() => window.__cinder!.sim.state.player.dock.mode);
    if (DOCKED.includes(name)) {
      expect(mode, name).toBe('docked');
      await expect(page.getByTestId('station-hub')).toBeVisible();
    } else {
      expect(mode, name).toBe('flying');
      await expect(page.getByTestId('station-hub')).toBeHidden();
    }
    await page.screenshot({ path: `${test.info().project.outputDir}/fixture-${name}.png` });
  }
  // an unknown fixture falls back to the menu and says why
  await page.goto('/?fixture=no-such-fixture');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => window.__cinderFixture)).toContain('Unknown fixture');
  expect(errors.filter((e) => !e.includes('Unknown fixture'))).toEqual([]);
});
