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

for (const fixture of ['training-mid', 'escort'] as const) {
  test(`goal marker on screen, bold arrow off screen (${fixture})`, async ({ page }, info) => {
    await loadFixture(page, fixture, { params: { lang: 'en' }, ticks: 10 });
    const hasGoal = await page.evaluate(() => {
      const { sim, game } = window.__cinder!;
      return (game as unknown as { career: { arrowTarget(s: unknown): unknown } }).career.arrowTarget(sim.state) !== null;
    });
    test.skip(!hasGoal, `no positioned goal in the ${fixture} fixture`);

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
  });
}
