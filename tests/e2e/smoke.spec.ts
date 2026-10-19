import { expect, test } from './test';
import type { Page } from '@playwright/test';

/** A new game starts docked – F undocks. */
async function undock(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
}

test('game loads and the ship flies forward', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/?play');
  await expect(page.locator('#game canvas')).toBeVisible();
  await undock(page);

  const { x0, t0 } = await page.evaluate(() => {
    const state = window.__cinder!.sim.state;
    return { x0: state.player.body.pos.x, t0: state.tick };
  });
  await page.keyboard.down('KeyW');
  // at least a second of simulation (60 steps) – independent of the browser's speed
  await page.waitForFunction((t) => window.__cinder!.sim.state.tick >= t + 60, t0);
  // screenshot during thrust – after releasing W the front engines would already brake (dampers)
  await page.screenshot({ path: 'test-results/m0-flight.png' });
  await page.keyboard.up('KeyW');
  const x1 = await page.evaluate(() => window.__cinder!.sim.state.player.body.pos.x);

  expect(x1).toBeGreaterThan(x0 + 1);
  expect(errors).toEqual([]);
});

test('the world has asteroids and the laser mines them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/?play');
  await undock(page);
  expect(await page.evaluate(() => window.__cinder!.sim.state.world.asteroids().length)).toBeGreaterThan(0);

  // overview: zoomed-out camera
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/m1-overview.png' });
  await page.mouse.wheel(0, -1500);

  // move the ship next to the nearest asteroid (the ship faces +x, the asteroid is in front of it)
  const target = await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const world = sim.state.world;
    const rock = world.asteroids()[0]!;
    const r = world.radiusOf(rock);
    const body = { pos: { x: rock.pos.x - r - 6, y: rock.pos.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    return rock.pos;
  });
  await page.waitForTimeout(1500); // the camera catches up with the ship

  const screen = await page.evaluate((p) => window.__cinder!.renderer.worldToScreen(p), target);
  await page.mouse.move(screen.x, screen.y);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/m1-mining.png' });
  await page.mouse.up({ button: 'right' });

  const cargo = await page.evaluate(() => {
    const c = window.__cinder!.sim.state.player.cargo;
    return c.iron + c.copper + c.ice + c.titanium;
  });
  expect(cargo).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});
