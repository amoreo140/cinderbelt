import { expect, test } from './test';
import type { Page } from '@playwright/test';

// M3b – combat HUD: silhouette with HP, shield and hull, hits on the screen edge, warning about pirates,
// loot from a wreck, death card with the black box and firing arcs in the shipyard.
// Screenshots go to the Playwright output directory (--output), test-results/ by default.

const MODULES = { grid: '/src/sim/ship/grid.ts', properties: '/src/sim/ship/properties.ts', enemies: '/src/sim/combat/enemies.ts' } as const;
type GridModule = typeof import('../../src/sim/ship/grid');
type PropertiesModule = typeof import('../../src/sim/ship/properties');
type EnemiesModule = typeof import('../../src/sim/combat/enemies');

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/${name}.png` });

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 60_000 });
}

/** Combat ship (starter + 2 cannons + shield); optionally some parts damaged. */
async function setupFighter(page: Page, pos: { x: number; y: number } | null, damage = false): Promise<void> {
  await page.evaluate(
    async ({ p, modules, damage }) => {
      const { createGrid } = (await import(/* @vite-ignore */ modules.grid)) as GridModule;
      const { computeProperties } = (await import(/* @vite-ignore */ modules.properties)) as PropertiesModule;
      const { sim } = window.__cinder!;
      const player = sim.state.player;
      const grid = createGrid([
        ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
        ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
        ['engine', 0, -2, 1], ['engine', 0, 2, 3], ['cannon', 1, 2, 0], ['cannon', 1, -2, 0], ['shield', -1, 2], ['armor', -1, -2],
      ]);
      const props = computeProperties(grid);
      player.grid = grid;
      player.props = props;
      player.gridVersion++;
      player.hp = new Map();
      if (damage) {
        // armour and engine scratched (warning), tank critical
        const at = (x: number, y: number) => grid.parts.find((q) => q.x === x && q.y === y)!;
        player.hp.set(at(-1, -2).id, 13);
        player.hp.set(at(0, -2).id, 14);
        player.hp.set(at(1, 1).id, 6);
      }
      player.energy = props.batteryCapacity;
      player.shield = props.shield.capacity;
      player.fuel = props.fuelCapacity;
      if (p) {
        const body = { pos: p, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
        player.body = body;
        player.prevBody = body;
        sim.state.combat.enemies = [];
        sim.state.combat.projectiles = [];
      }
    },
    { p: pos, modules: MODULES, damage },
  );
}

/** A frozen pirate (no engines) – it shoots; on patrol it notices the player on its own (warning). */
async function spawnPirate(page: Page, pos: { x: number; y: number }, angle: number): Promise<string> {
  return page.evaluate(
    async ({ pos, angle, modules }) => {
      const { createEnemy } = (await import(/* @vite-ignore */ modules.enemies)) as EnemiesModule;
      const { sim } = window.__cinder!;
      const e = createEnemy({ id: 'pr:e2e:m3b', kind: 'hammer', tier: 1, pos, angle, home: pos, orbit: 1 });
      e.props = { ...e.props, thrust: { forward: 0, backward: 0, left: 0, right: 0 }, torque: 0 };
      for (const part of e.grid.parts) e.hp.set(part.id, part.partId === 'cockpit' ? 20 : 10);
      e.shield = 30;
      sim.state.combat.enemies.push(e);
      return e.id;
    },
    { pos, angle, modules: MODULES },
  );
}

async function aimAt(page: Page, p: { x: number; y: number }): Promise<void> {
  const screen = await page.evaluate((q) => window.__cinder!.renderer.worldToScreen(q), p);
  await page.mouse.move(screen.x, screen.y);
}

test('M3b: combat HUD – pirate alert, ship status, hit markers, salvage', async ({ page }) => {
  // the shots aim by screen position – a shaking camera (M3.8) would move the aim point
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ v: 1, cameraShake: false, combatZoom: false })));
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.keyboard.press('KeyK'); // controls help collapsed – combat needs a free screen

  const base = { x: 2400, y: -1300 };
  await setupFighter(page, base, true);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 250);
  await waitTicks(page, 30);

  // ship state in the console: silhouette, shield, hull, cannons, damaged parts
  await expect(page.getByTestId('ship-silhouette')).toBeVisible();
  await expect(page.getByTestId('gauge-shield')).toBeVisible();
  await expect(page.getByTestId('damaged-parts')).toContainText('3 poškodené diely');
  await expect(page.getByTestId('cannons-ready')).toContainText('2');

  // --- warning: a pirate on patrol notices the player
  const pirate = { x: base.x + 24, y: base.y + 9 };
  await spawnPirate(page, pirate, Math.PI);
  await expect(page.getByTestId('pirate-alert')).toHaveAttribute('data-mode', 'alert', { timeout: 30_000 });
  await aimAt(page, pirate);
  await waitTicks(page, 20);
  await shot(page, 'm3b-pirate-alert');

  // --- fight: the player shoots, the pirate hits the shield (azure arrows on the edge)
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.shield = p.props.shield.capacity;
    p.shieldDelay = 0;
  });
  await page.mouse.down({ button: 'left' });
  await expect(page.locator('.cb-hit--shield').first()).toBeAttached({ timeout: 60_000 });
  await aimAt(page, pirate);
  await shot(page, 'm3b-fight-hud');
  await expect(page.getByTestId('pirate-alert')).toHaveAttribute('data-mode', 'compact', { timeout: 30_000 });

  // --- hull: shield off, hits go into the parts (red arrows, edge flash, cells blinking)
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.shield = 0;
    p.shieldDelay = 100000;
    // the screenshot catches the start of the edge flash (software WebGL is slower than the animation)
    const style = document.createElement('style');
    style.id = 'e2e-freeze';
    style.textContent = '.cb-vignette { animation-play-state: paused !important; }';
    document.head.append(style);
  });
  await expect(page.locator('.cb-hit--hull').first()).toBeAttached({ timeout: 60_000 });
  await page.waitForSelector('.cb-vignette', { state: 'attached', timeout: 60_000 });
  await shot(page, 'm3b-hull-hit');
  await page.evaluate(() => document.getElementById('e2e-freeze')?.remove());
  await page.mouse.up({ button: 'left' });

  // --- loot: the pirate goes down, to the wreck, the F prompt with its contents, loading
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const e = sim.state.combat.enemies.find((x) => x.id === 'pr:e2e:m3b')!;
    const cockpit = e.grid.parts.find((p) => p.partId === 'cockpit')!;
    e.hp.set(cockpit.id, 1);
    e.shield = 0;
    e.props = { ...e.props, shield: { ...e.props.shield, capacity: 0 } };
    for (const w of e.props.weapons) e.cooldowns.set(w.partId, 100000);
  });
  // volley of strong player shots through the pirate (independent of the browser's speed)
  for (let i = 0; i < 40; i++) {
    const alive = await page.evaluate((i) => {
      const { sim } = window.__cinder!;
      const e = sim.state.combat.enemies.find((x) => x.id === 'pr:e2e:m3b');
      if (!e) return false;
      e.shield = 0;
      e.shieldDelay = 100000;
      const p = sim.state.player.body.pos;
      const dx = e.body.pos.x - p.x;
      const dy = e.body.pos.y - p.y;
      const d = Math.hypot(dx, dy);
      const dir = { x: dx / d, y: dy / d };
      for (let k = -2; k <= 2; k++) {
        const pos = { x: e.body.pos.x - dir.x * 6 - dir.y * k * 0.8, y: e.body.pos.y - dir.y * 6 + dir.x * k * 0.8 };
        sim.state.combat.projectiles.push({ id: 920000 + i * 10 + k + 2, owner: 'player', pos, vel: { x: dir.x * 90, y: dir.y * 90 }, ttl: 120, damage: 400, tier: 1, origin: pos });
      }
      return true;
    }, i);
    if (!alive) break;
    await waitTicks(page, 8);
  }
  expect(await page.evaluate(() => window.__cinder!.sim.state.combat.enemies.some((e) => e.id === 'pr:e2e:m3b'))).toBe(false);
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    sim.state.combat.projectiles = [];
    const w = sim.state.combat.wrecks.find((x) => x.loot.cargo.iron > 0)!;
    w.loot.parts['cannon:1'] = 1;
    // only the wreck with loot – scrap without it would be loaded by F earlier
    sim.state.combat.wrecks = [w];
    const p = sim.state.player;
    const pos = { x: w.body.pos.x - w.props.boundingRadius - p.props.boundingRadius - 2, y: w.body.pos.y };
    const body = { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    p.body = body;
    p.prevBody = body;
    for (const x of sim.state.combat.wrecks) x.body = { ...x.body, vel: { x: 0, y: 0 }, angVel: 0 };
  });
  await expect(page.getByTestId('salvage-prompt')).toHaveAttribute('data-in-range', 'true', { timeout: 30_000 });
  await page.mouse.move(900, 200);
  await waitTicks(page, 10);
  await shot(page, 'm3b-salvage-prompt');

  await page.keyboard.press('KeyF');
  await expect(page.getByTestId('toast')).toContainText('Naložené z vraku', { timeout: 30_000 });
  await expect(page.getByTestId('salvage-hold')).toBeVisible();
  await shot(page, 'm3b-salvage-loaded');

  expect(errors).toEqual([]);
});

test('M3b: death card shows the black box with the lost parts', async ({ page }) => {
  // the shots aim by screen position – a shaking camera (M3.8) would move the aim point
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ v: 1, cameraShake: false, combatZoom: false })));
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('preset-hard').click();
  await page.getByTestId('seed-input').fill('cierna-skrinka-7');
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 30_000 });
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await waitTicks(page, 20);

  // cargo and parts from wrecks that the hard penalty takes; then a volley of pirate shots
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const { player, combat } = sim.state;
    player.cargo.iron = 24.5;
    player.cargo.copper = 8;
    player.salvage = { 'cannon:1': 1, 'armor:2': 2 };
    player.shield = 0;
    const p = player.body.pos;
    for (let k = 0; k < 60; k++) {
      const pos = { x: p.x + 14 + k * 2.2, y: p.y + ((k % 3) - 1) * 0.9 };
      combat.projectiles.push({ id: 910000 + k, owner: 'e2e-pirate', pos, vel: { x: -80, y: 0 }, ttl: 600, damage: 22, tier: 1, origin: pos });
    }
  });
  await expect(page.getByTestId('death-card')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('death-blackbox')).toBeVisible();
  await page.waitForTimeout(1500); // in the middle of playback
  await shot(page, 'm3b-death-replay');
  await page.waitForTimeout(2600);
  await shot(page, 'm3b-death-card');
  await page.getByTestId('death-continue').click();
  await expect(page.getByTestId('death-card')).toBeHidden();
  expect(errors).toEqual([]);
});

test('M3b: shipyard – cannon fire arcs, second hotkey row and weapon stats', async ({ page }) => {
  // the shots aim by screen position – a shaking camera (M3.8) would move the aim point
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ v: 1, cameraShake: false, combatZoom: false })));
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await setupFighter(page, null);
  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('yard-view')).toBeVisible();
  await waitTicks(page, 30);
  // Shift + 1 = cannon (the second row of keys)
  await page.keyboard.down('Shift');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('palette-cannon')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.yd-pal-detail')).toContainText('Poškodenie');
  await page.mouse.move(640, 600);
  await waitTicks(page, 20);
  await shot(page, 'm3b-shipyard-arcs');
  expect(errors).toEqual([]);
});

test('M3b: UI kit – combat components and states', async ({ page }) => {
  // the shots aim by screen position – a shaking camera (M3.8) would move the aim point
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ v: 1, cameraShake: false, combatZoom: false })));
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto('/ui-kit.html');
  const section = page.locator('.kit-section').filter({ has: page.getByRole('heading', { name: 'Combat', exact: true }) });
  await expect(section).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500); // fonts and icons
  await section.screenshot({ path: `${test.info().project.outputDir}/m3b-kit-combat.png` });
  const hud = page.locator('.kit-screen').first();
  await hud.scrollIntoViewIfNeeded();
  await hud.screenshot({ path: `${test.info().project.outputDir}/m3b-kit-hud.png` });
  expect(errors).toEqual([]);
});
