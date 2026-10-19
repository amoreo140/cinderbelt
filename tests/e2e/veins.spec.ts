import { expect, test } from './test';
import type { Page } from '@playwright/test';

// M2d: mining a vein (active segment, bonus, heat), ice bursting, a ship with a heavy laser
// and a large cargo (couplings) and a shipyard with a hull budget. Screenshots test-results-m2d/m2d-*.png.

const SHOTS = 'test-results-m2d';
/** The veins module from the Vite server (in the browser) – to compute the active segment in the tests. */
const VEINS = '/src/sim/mining/veins.ts';
type Veins = typeof import('../../src/sim/mining/veins');

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function startFlying(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  // controls help collapsed – does not cover the rocks on the right
  await page.keyboard.press('KeyK');
}

/** A point in the middle of the active segment of the longest visible vein of rock `id` – in window pixels. */
async function segmentOnScreen(page: Page, id: string): Promise<{ x: number; y: number; vein: number } | null> {
  return page.evaluate(async ([rockId, path]) => {
    const V = (await import(path)) as Veins;
    const { sim, renderer } = window.__cinder!;
    const { world } = sim.state;
    const rock = world.findAsteroid(rockId);
    if (!rock || world.remaining(rock) <= 0) return null;
    const r = world.radiusOf(rock);
    const time = sim.state.tick * (1 / 60);
    const state = world.veinState(rock);
    let best: { x: number; y: number; vein: number; up: number } | null = null;
    for (const vein of V.veinsOf(rock)) {
      const seg = V.activeSegment(vein, r, state);
      const p = V.veinPointAt(rock, vein, r, time, seg.center);
      if (!best || p.up > best.up) best = { ...renderer.worldToScreen(p.pos), vein: vein.index, up: p.up };
    }
    return best;
  }, [id, VEINS] as const);
}

test('M2d: mining an ore vein – active segment, ×1.5 bonus, heat bar and overheating', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await startFlying(page);

  // the ship next to a large veined rock at the start
  const rockId = await page.evaluate(async (path) => {
    const V = (await import(path)) as Veins;
    const { sim } = window.__cinder!;
    const rocks = sim.state.world
      .asteroids()
      .filter((a) => V.veinsOf(a).length > 0 && Math.hypot(a.pos.x - 75, a.pos.y - 45) < 80)
      .sort((a, b) => b.baseRadius - a.baseRadius);
    const rock = rocks[0]!;
    const pos = { x: rock.pos.x - rock.baseRadius - 4.5, y: rock.pos.y - 2.5 };
    const body = { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    sim.state.player.dampers = true;
    return rock.id;
  }, VEINS);
  await page.mouse.move(900, 250);
  await page.mouse.wheel(0, -2600);
  await waitTicks(page, 40);

  // mines and follows the active segment with the mouse
  const first = await segmentOnScreen(page, rockId);
  expect(first).not.toBeNull();
  await page.mouse.move(first!.x, first!.y);
  await page.mouse.down({ button: 'right' });
  let bonusSeen = false;
  for (let i = 0; i < 30; i++) {
    await waitTicks(page, 4);
    const p = await segmentOnScreen(page, rockId);
    if (p) await page.mouse.move(p.x, p.y);
    const bonus = await page.evaluate(() => window.__cinder!.sim.state.player.beams.some((b) => b.bonus > 1));
    if (bonus && !bonusSeen && i > 6) {
      bonusSeen = true;
      await expect(page.getByTestId('hud-vein-bonus')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/m2d-vein-mining.png` });
    }
  }
  expect(bonusSeen).toBe(true);
  const vein = await page.evaluate((id) => window.__cinder!.sim.state.world.veins.get(id) ?? null, rockId);
  expect(vein).not.toBeNull();

  // hold on the vein until the laser overheats (4 s on the vein)
  await page.waitForFunction(() => [...window.__cinder!.sim.state.player.heat.values()].some((h) => h.cooling > 0), undefined, {
    timeout: 60_000,
    polling: 100,
  }).catch(() => undefined);
  for (let i = 0; i < 80; i++) {
    const cooling = await page.evaluate(() => [...window.__cinder!.sim.state.player.heat.values()].some((h) => h.cooling > 0));
    if (cooling) break;
    const p = await segmentOnScreen(page, rockId);
    if (p) await page.mouse.move(p.x, p.y);
    await waitTicks(page, 4);
  }
  await expect(page.getByTestId('hud-heat')).toBeVisible();
  await expect(page.getByTestId('hud-heat')).toContainText('chladne');
  await page.screenshot({ path: `${SHOTS}/m2d-vein-overheat.png` });
  await page.mouse.up({ button: 'right' });
  expect(errors).toEqual([]);
});

test('M2d: ice cracks at 30 % into three fragments with a dust burst', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await startFlying(page);

  // an ice rock somewhere in the home belt (the world loads around the ship)
  let ice: { id: string; pos: { x: number; y: number }; r: number } | null = null;
  const spots: [number, number][] = [];
  for (let k = 0; k < 16; k++) spots.push([Math.round(Math.cos(k * 0.9) * (150 + k * 40)), Math.round(Math.sin(k * 0.9) * (150 + k * 40))]);
  for (const [x, y] of spots) {
    await page.evaluate(([px, py]) => {
      const { sim } = window.__cinder!;
      const body = { pos: { x: px, y: py }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
      sim.state.player.body = body;
      sim.state.player.prevBody = body;
    }, [x, y] as const);
    await waitTicks(page, 3);
    ice = await page.evaluate(() => {
      const { world } = window.__cinder!.sim.state;
      // a lone ice rock (free space around it – fragments and dust will be visible in the screenshot)
      const all = world.asteroids();
      const a = all.find(
        (r) =>
          r.resource === 'ice' &&
          r.baseRadius > 2 &&
          !r.id.includes('~') &&
          all.every((o) => o === r || Math.hypot(o.pos.x - r.pos.x, o.pos.y - r.pos.y) > r.baseRadius + o.baseRadius + 7),
      );
      return a ? { id: a.id, pos: a.pos, r: a.baseRadius } : null;
    });
    if (ice) break;
  }
  expect(ice).not.toBeNull();
  const rock = ice!;
  // a rock almost at its bursting limit, the ship next to it
  await page.evaluate((p) => {
    const { sim, renderer } = window.__cinder!;
    const { world } = sim.state;
    const a = world.findAsteroid(p.id)!;
    world.extract(a, a.initialAmount * 0.69);
    const body = { pos: { x: p.pos.x - p.r - 5, y: p.pos.y - 1 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    (renderer as unknown as { combat: { timeScale: number } }).combat.timeScale = 0.35;
  }, rock);
  await page.mouse.move(900, 250);
  await page.mouse.wheel(0, -2000);
  await waitTicks(page, 45);
  // keep the cursor on the rock: under a loaded software renderer the camera may still be catching up
  // with the teleported ship, and a screen point taken once would drift off the rock as it settles
  const aim = async () => {
    const screen = await page.evaluate((p) => window.__cinder!.renderer.worldToScreen(p), rock.pos);
    await page.mouse.move(screen.x, screen.y);
  };
  await aim();
  await page.mouse.down({ button: 'right' });
  const crackDeadline = Date.now() + 30_000;
  while (!(await page.evaluate((id) => window.__cinder!.sim.state.world.cracked.has(id), rock.id))) {
    if (Date.now() > crackDeadline) throw new Error(`ice rock ${rock.id} did not crack within 30 s`);
    await waitTicks(page, 4);
    await aim();
  }
  await page.mouse.up({ button: 'right' });
  await waitTicks(page, 8);
  await page.screenshot({ path: `${SHOTS}/m2d-ice-crack.png` });
  const fragments = await page.evaluate(
    (id) => window.__cinder!.sim.state.world.asteroids().filter((a) => a.id.startsWith(`${id}~`)).length,
    rock.id,
  );
  expect(fragments).toBe(3);
  // after the dust dissolves: three fragments in the rock's place
  await waitTicks(page, 150);
  await page.screenshot({ path: `${SHOTS}/m2d-ice-fragments.png` });
  expect(errors).toEqual([]);
});

/** Window pixel above the centre of a hangar cell (on the floor). */
async function cellPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([cx, cy]) => window.__cinder!.renderer.hangarCellToScreen(cx, cy, -0.37), [x, y] as const);
}

async function clickCell(page: Page, x: number, y: number): Promise<void> {
  const p = await cellPoint(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

/** A mouse drag with the left button across cells (painting parts). */
async function paint(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await cellPoint(page, ...from);
  const b = await cellPoint(page, ...to);
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

const draftParts = (page: Page) =>
  page.evaluate(() => (window.__cinder!.game as unknown as { yard: { draft: { grid: { parts: unknown[] } } } }).yard.draft.grid.parts.length);

test('M2d: shipyard hull budget, heavy laser and large cargo with hull connectors', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.credits = 30_000;
    const home = s.stations.get('home')!;
    home.parts['heavyLaser:1'] = 1;
    home.parts['largeCargo:1'] = 1;
    home.parts['armor:1'] = 12;
  });

  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await expect(page.getByTestId('yard-hull')).toContainText('14 / 28 b');
  await expect(page.getByTestId('yard-hull')).toContainText('kokpit T1');

  // heavy laser 2×1 top right, large cargo 2×2 bottom right
  await page.getByTestId('palette-heavyLaser').click();
  await clickCell(page, 1, 2);
  await expect.poll(() => draftParts(page)).toBe(15);
  await page.getByTestId('palette-largeCargo').click();
  // duch 2×2 pod kurzorom
  const ghostAt = await cellPoint(page, 1, -3);
  await page.mouse.move(ghostAt.x, ghostAt.y, { steps: 3 });
  await waitTicks(page, 5);
  await page.screenshot({ path: `${SHOTS}/m2d-shipyard-ghost-2x2.png` });
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => draftParts(page)).toBe(16);
  // the label is in capitals via CSS (af-label): "TRUP 19 / 28 b · kokpit T1"
  await expect(page.getByTestId('yard-hull')).toContainText(/Trup\s*19 \/ 28 b\s*· kokpit T1/);
  await expect(page.getByTestId('yard-hull-points')).toHaveText('19 / 28 b');
  await page.keyboard.press('Escape');
  await page.mouse.move(640, 300);
  await waitTicks(page, 10);
  await page.screenshot({ path: `${SHOTS}/m2d-shipyard-budget.png` });

  // over the budget: two columns of armour on the left (29 b > 28 b)
  await page.getByTestId('palette-armor').click();
  await paint(page, [-2, -1], [-2, 2]);
  await paint(page, [-3, -1], [-3, 2]);
  await paint(page, [-2, -2], [-3, -2]);
  await expect.poll(() => draftParts(page)).toBe(26);
  await expect(page.getByTestId('yard-hull-points')).toHaveText('29 / 28 b');
  await expect(page.getByTestId('yard-check')).toContainText('Kokpit T1 unesie 28 b trupu (máš 29 b).');
  await expect(page.getByTestId('yard-commit')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await page.mouse.move(640, 300);
  await waitTicks(page, 10);
  await page.screenshot({ path: `${SHOTS}/m2d-shipyard-hull-budget.png` });

  // back under the budget and confirm
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(() => draftParts(page)).toBe(16);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.grid.parts.length === 16);
  const props = await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player.props;
    return { cargo: p.cargoCapacity, lasers: p.lasers.length, heavy: p.lasers.some((l) => l.heavy) };
  });
  expect(props).toEqual({ cargo: 130 + 300, lasers: 2, heavy: true });

  // departure: a ship with a heavy laser and a large cargo, couplings only between different parts
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.keyboard.press('KeyK');
  // further from the station, nose up (the landing prompt would cover the ship)
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const body = { pos: { x: 30, y: 30 }, vel: { x: 0, y: 0 }, angle: Math.PI / 2, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
  });
  await page.mouse.move(640, 120);
  await page.mouse.wheel(0, -3000);
  await waitTicks(page, 120);
  await page.screenshot({ path: `${SHOTS}/m2d-ship-heavy-laser-large-cargo.png` });
  expect(errors).toEqual([]);
});
