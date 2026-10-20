import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { approachClamp } from './dockHelper';

/** Waits until the simulation ran at least `ticks` steps (whatever the browser speed). */
async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const);
}

test('M2a: start docked, mine, return, dock with F and sell', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // 1. start docked at the home station → hub
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  const hub = page.getByTestId('station-hub');
  await expect(hub).toBeVisible();
  await expect(hub).toContainText('Základňa Počiatok');
  await expect(page.getByTestId('hub-credits')).toHaveText('250 kr');
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.dock)).toEqual({ mode: 'docked', stationId: 'home' });
  await waitTicks(page, 120); // the camera moves to the dock view
  await page.screenshot({ path: 'test-results/m2a-hub.png' });

  // 3. the home station from the game camera with the docked ship (no UI)
  await page.evaluate(() => {
    document.getElementById('ui')!.style.display = 'none';
  });
  await waitTicks(page, 150);
  await page.screenshot({ path: 'test-results/m2a-home-docked.png' });
  await page.evaluate(() => {
    document.getElementById('ui')!.style.display = '';
  });

  // 2. undock with the button
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await expect(hub).toBeHidden();

  // to the asteroids and mine
  const target = await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const rocks = sim.state.world.circlesNear({ x: 75, y: 45 }, 40);
    const { circle } = rocks.sort((a, b) => b.circle.radius - a.circle.radius)[0]!;
    const body = { pos: { x: circle.pos.x - circle.radius - 7, y: circle.pos.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    return circle.pos;
  });
  await waitTicks(page, 60);
  const screen = await page.evaluate((p) => window.__cinder!.renderer.worldToScreen(p), target);
  await page.mouse.move(screen.x, screen.y);
  await page.mouse.down({ button: 'right' });
  const cargoTotal = () => {
    const c = window.__cinder!.sim.state.player.cargo;
    return c.iron + c.copper + c.ice + c.titanium;
  };
  await page.waitForFunction(`(${cargoTotal.toString()})() >= 3`);
  await page.mouse.up({ button: 'right' });

  // back home on the approach to the dock clamp (stopped, bow at the station) and dock with F
  await approachClamp(page, { stationId: 'home' });
  await waitTicks(page, 30);
  // the F key is a keycap, the prompt text follows it; the approach readout is all green
  await expect(page.getByTestId('dock-prompt')).toContainText('pristáť na stanici');
  await expect(page.getByTestId('dock-approach')).toHaveAttribute('data-ready', '1');
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'docked');
  await expect(hub).toBeVisible();

  // predaj na trhu
  const before = await page.evaluate(() => window.__cinder!.sim.state.credits);
  await page.keyboard.press('Digit2');
  await page.getByText('Max', { exact: true }).click();
  const mined = await page.evaluate(() => {
    const c = window.__cinder!.sim.state.player.cargo;
    return (Object.keys(c) as (keyof typeof c)[]).filter((id) => c[id] > 0);
  });
  for (const id of mined) await page.getByTestId(`sell-${id}`).click();
  await page.waitForFunction(`(${cargoTotal.toString()})() === 0`);
  const after = await page.evaluate(() => window.__cinder!.sim.state.credits);
  expect(after).toBeGreaterThanOrEqual(before + 7); // ≥ 3 u × the cheapest sell price 2.4 kr
  await expect(page.getByTestId('hub-credits')).toHaveText(`${after} kr`);
  await waitTicks(page, 30);
  await page.screenshot({ path: 'test-results/m2a-market.png' });

  expect(errors).toEqual([]);
});

test('M2a: refuel from ice and for credits in the service tab', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.fuel = 40;
    p.cargo.ice = 10;
  });
  await page.keyboard.press('Digit1');
  await page.getByTestId('refuel-ice').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.fuel >= 60 - 1e-6);
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.cargo.ice)).toBe(0);
  await page.getByTestId('refuel-full').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.fuel >= 120 - 1e-6);
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(250 - 120);
  await waitTicks(page, 60);
  await page.screenshot({ path: 'test-results/m2a-service.png' });
  expect(errors).toEqual([]);
});
