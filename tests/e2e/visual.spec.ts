import { expect, test } from './test';
import type { Page } from '@playwright/test';

/** Waits until the simulation has run at least `ticks` steps (independent of the browser's speed). */
async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const);
}

test('M1.5: ship models, overview and mining from the muzzle', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  // a new game starts docked – F undocks
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');

  // zoomed-in ship (wheel to the minimum)
  await page.mouse.move(900, 250);
  await page.mouse.wheel(0, -3000);
  await waitTicks(page, 40);
  await page.screenshot({ path: 'test-results/m15-ship.png' });

  // zoomed-out view with asteroids
  await page.mouse.wheel(0, 3000);
  await waitTicks(page, 40);
  await page.screenshot({ path: 'test-results/m15-overview.png' });
  await page.mouse.wheel(0, -2200);

  // the ship next to a big asteroid at the start, the target slightly to the side (the laser head turns)
  const target = await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const rocks = sim.state.world.circlesNear({ x: 75, y: 45 }, 40);
    const { circle } = rocks.sort((a, b) => b.circle.radius - a.circle.radius)[0]!;
    const pos = { x: circle.pos.x - circle.radius - 8, y: circle.pos.y - 4 };
    const body = { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    return circle.pos;
  });
  await waitTicks(page, 60);
  const screen = await page.evaluate((p) => window.__cinder!.renderer.worldToScreen(p), target);
  await page.mouse.move(screen.x, screen.y);
  await page.mouse.down({ button: 'right' });
  await waitTicks(page, 45);
  await page.screenshot({ path: 'test-results/m15-mining.png' });

  // the beam starts at the mouth of the laser model
  const check = await page.evaluate(() => {
    const { sim, renderer } = window.__cinder!;
    const beam = sim.state.player.beams[0];
    return { beam: beam ?? null, muzzle: beam ? renderer.muzzleSim(beam.laser) : null };
  });
  await page.mouse.up({ button: 'right' });
  expect(check.beam?.asteroidId).toBeTruthy();
  expect(check.muzzle).not.toBeNull();
  const d = Math.hypot(check.muzzle!.x - check.beam!.from.x, check.muzzle!.y - check.beam!.from.y);
  expect(d).toBeLessThan(0.75);
  expect(errors).toEqual([]);
});
