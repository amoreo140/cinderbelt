import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// Navigation to the goal: a ring + "name · distance" on the goal while it is on screen (goal-mark),
// a bold edge arrow while it is off screen (objective-arrow). The ship is moved next to / away from the
// goal through the dev hooks, the camera follows it.

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 60_000 });
}

/** Puts the ship `dx, dy` from the goal (the first objective with a position) and stops it. */
async function shipNearGoal(page: Page, dx: number, dy: number): Promise<boolean> {
  const ok = await page.evaluate(
    ([x, y]) => {
      const { sim, game } = window.__cinder!;
      const goal = (game as unknown as { career: { arrowTarget(s: unknown): { pos: { x: number; y: number } } | null } }).career.arrowTarget(sim.state);
      if (!goal) return false;
      const body = sim.state.player.body;
      body.pos.x = goal.pos.x + x!;
      body.pos.y = goal.pos.y + y!;
      body.vel.x = 0;
      body.vel.y = 0;
      return true;
    },
    [dx, dy] as const,
  );
  await waitTicks(page, 12);
  return ok;
}

{
  const fixture = 'escort';
  test(`goal marker on screen, bold arrow off screen (${fixture})`, async ({ page }, info) => {
    await loadFixture(page, fixture, { params: { lang: 'en' }, ticks: 10 });

    // 1) close to the goal: the ring
    expect(await shipNearGoal(page, 0, 8)).toBe(true);
    const mark = page.getByTestId('goal-mark');
    // the marks are zero-size anchors: their ring and plate are what the player sees
    await expect(mark).toBeAttached();
    await expect(mark.locator('.hud-goal-ring')).toBeVisible();
    await expect(mark.locator('.hud-goal-label')).toBeVisible();
    await expect(page.getByTestId('objective-arrow')).toHaveCount(0);
    await expect(mark).toContainText(/\d+ [^\s\d]+/);
    await page.screenshot({ path: info.outputPath(`goal-mark-${fixture}.png`) });

    // 2) far away: the arrow with its label, no ring
    expect(await shipNearGoal(page, 0, 2500)).toBe(true);
    const arrow = page.getByTestId('objective-arrow');
    await expect(arrow).toBeAttached();
    await expect(arrow.locator('.hud-arrow-label')).toBeVisible();
    await expect(page.getByTestId('goal-mark')).toHaveCount(0);
    await expect(arrow).toContainText(/\d+ [^\s\d]+/);
    await page.screenshot({ path: info.outputPath(`goal-arrow-${fixture}.png`) });

    // 3) the arrow along a side edge: the label stays clear of the head (screenshots to look at)
    for (const [name, dx] of [['east', 2500], ['west', -2500]] as const) {
      expect(await shipNearGoal(page, dx, 0)).toBe(true);
      await expect(arrow.locator('.hud-arrow-label')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`goal-arrow-${name}.png`) });
    }
  });
}

test('training: the goal marker names the buoy', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('preset-standard').click();
  await page.getByTestId('seed-input').fill('vycvik-1337');
  await page.getByTestId('ng-training').getByRole('button', { name: 'Hrať výcvik' }).click();
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 120_000 });
  await page.getByTestId('undock').click({ timeout: 20_000 });
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', null, { timeout: 30_000 });
  // the buoy is off screen or on it: either mark carries its name
  const mark = page.locator('[data-testid="goal-mark"], [data-testid="objective-arrow"]');
  await expect(mark.first()).toContainText('Bója Cechu', { timeout: 20_000 });
  // the mark is drawn where the player can see it: clear of the bottom-centre training panel, or above it
  // (the HUD is click-through, so elementFromPoint cannot tell; compare the stacking instead)
  const label = mark.first().locator('.hud-goal-label, .hud-arrow-label');
  await expect(label).toBeVisible();
  const seen = await label.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const panel = document.querySelector('[data-testid="training-panel"]')?.getBoundingClientRect();
    const overlap = !!panel && b.left < panel.right && b.right > panel.left && b.top < panel.bottom && b.bottom > panel.top;
    const z = (e: Element | null): number => Number(e ? getComputedStyle(e).zIndex : 0) || 0;
    const markZ = z(el.closest('[data-testid="goal-mark"], [data-testid="objective-arrow"]'));
    const layerZ = z(document.querySelector('[data-testid="training"]'));
    return { overlap, above: markZ > layerZ };
  });
  expect(seen.overlap === false || seen.above).toBe(true);
  await page.screenshot({ path: info.outputPath('goal-training.png') });
});
