import { expect, test } from './test';
import type { Page } from '@playwright/test';

// Mining 2.0: the new beam (normal, on the vein bonus segment, near
// overheating, out of energy, two lasers on one rock), rich nuggets (break off, picked up by flying
// through and by the tractor beam T), the scanner's ore assay (rich-rock callout, radar tint, the best
// grade on the map) and the point light at the hit following the graphics quality.
// Screenshots go to the Playwright output folder (--output).

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/${name}.png` });

/** Game modules from the Vite server (in the browser). */
const MOD = { veins: '/src/sim/mining/veins.ts', grade: '/src/sim/mining/grade.ts', grid: '/src/sim/ship/grid.ts', props: '/src/sim/ship/properties.ts' } as const;
type Veins = typeof import('../../src/sim/mining/veins');
type Grade = typeof import('../../src/sim/mining/grade');
type Grid = typeof import('../../src/sim/ship/grid');
type Props = typeof import('../../src/sim/ship/properties');

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

async function waitFrames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );
}

/** Flying with a mining ship: two lasers forward, a tractor beam, no reactor (the battery can run dry). */
async function start(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.keyboard.press('KeyK');
  await page.evaluate(async (mod) => {
    const G = (await import(mod.grid)) as Grid;
    const P = (await import(mod.props)) as Props;
    const { sim, renderer } = window.__cinder!;
    const grid = G.createGrid([
      ['cockpit', 0, 0],
      ['miningLaser', 1, 1],
      ['miningLaser', 1, -1],
      ['cargo', 0, 1],
      ['cargo', 0, -1],
      ['tractorBeam', -1, 1],
      ['fuelTank', -1, 0],
      ['battery', -1, -1],
      ['engine', -2, 0],
    ]);
    const p = sim.state.player;
    p.grid = grid;
    p.blueprint = grid;
    p.props = P.computeProperties(grid);
    p.gridVersion++;
    p.energy = p.props.batteryCapacity;
    renderer.setGraphicsQuality('high');
  }, MOD);
}

/** Puts the ship next to the biggest veined rock of the start cluster (or the given rock), facing it. */
async function parkAt(page: Page, rockId?: string): Promise<string> {
  return page.evaluate(
    async ([id, path]) => {
      const V = (await import(path)) as Veins;
      const { sim } = window.__cinder!;
      const world = sim.state.world;
      const rock = id
        ? world.findAsteroid(id)!
        : world
            .asteroids()
            .filter((a) => V.veinsOf(a).length > 0 && a.resource !== 'ice' && Math.hypot(a.pos.x - 75, a.pos.y - 45) < 80)
            .sort((a, b) => b.baseRadius - a.baseRadius)[0]!;
      const r = world.radiusOf(rock);
      const pos = { x: rock.pos.x - r - 4.2, y: rock.pos.y - 1.2 };
      const body = { pos, vel: { x: 0, y: 0 }, angle: Math.atan2(rock.pos.y - pos.y, rock.pos.x - pos.x), angVel: 0 };
      sim.state.player.body = body;
      sim.state.player.prevBody = body;
      sim.state.player.dampers = true;
      world.update(pos);
      return rock.id;
    },
    [rockId, MOD.veins] as const,
  );
}

/**
 * Waits until the camera has caught up with the ship: it follows with a lag measured in frames, and
 * after `parkAt` moves the ship a slow software renderer may still be on the way after the ticks a spec
 * waits – a screen point taken then would aim the mouse somewhere else once the camera settles.
 */
async function settleCamera(page: Page): Promise<void> {
  const shipOnScreen = () => page.evaluate(() => window.__cinder!.renderer.worldToScreen(window.__cinder!.sim.state.player.body.pos));
  let prev = await shipOnScreen();
  for (let i = 0; i < 120; i++) {
    await waitFrames(page, 2);
    const now = await shipOnScreen();
    if (Math.hypot(now.x - prev.x, now.y - prev.y) < 0.5) return;
    prev = now;
  }
}

/** Screen point of the active vein segment of the rock (the best visible vein), or of its near side. */
async function rockPoint(page: Page, id: string, onVein: boolean): Promise<{ x: number; y: number }> {
  await settleCamera(page);
  return page.evaluate(
    async ([rockId, vein, path]) => {
      const V = (await import(path)) as Veins;
      const { sim, renderer } = window.__cinder!;
      const world = sim.state.world;
      const rock = world.findAsteroid(rockId)!;
      const r = world.radiusOf(rock);
      if (vein) {
        const time = sim.state.tick / 60;
        const state = world.veinState(rock);
        let best: { pos: { x: number; y: number }; up: number } | null = null;
        for (const v of V.veinsOf(rock)) {
          const p = V.veinPointAt(rock, v, r, time, V.activeSegment(v, r, state).center);
          if (!best || p.up > best.up) best = p;
        }
        if (best) return renderer.worldToScreen(best.pos);
      }
      // a point on the rock off the veins: the lower half towards the ship
      return renderer.worldToScreen({ x: rock.pos.x - r * 0.35, y: rock.pos.y - r * 0.45 });
    },
    [id, onVein, MOD.veins] as const,
  );
}

const keepCharged = (page: Page) =>
  page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.energy = p.props.batteryCapacity;
    p.heat.clear();
    for (const r of ['iron', 'copper', 'ice', 'titanium'] as const) p.cargo[r] = 0;
  });

test('Mining 2.0: the beam – normal, vein bonus, near overheating, out of energy, two lasers', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await start(page);
  const rock = await parkAt(page);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -2600);
  await waitTicks(page, 30);

  // normal: both lasers on the rock (off the vein)
  const off = await rockPoint(page, rock, false);
  await page.mouse.move(off.x, off.y);
  await page.mouse.down({ button: 'right' });
  await waitTicks(page, 40);
  await keepCharged(page);
  await waitFrames(page, 6);
  const beams = await page.evaluate(() => window.__cinder!.sim.state.player.beams.filter((b) => b.asteroidId !== null).length);
  expect(beams).toBe(2);
  const stats = await page.evaluate(() => window.__cinder!.renderer.miningStats());
  expect(stats.beams).toBe(2);
  expect(stats.lightsInScene).toBe(2);
  expect(stats.lights).toBeGreaterThan(0);
  expect(stats.particles).toBeGreaterThan(0);
  await shot(page, 'beam-normal-two-lasers');

  // vein bonus: aim at the active segment and follow it
  let bonus = false;
  for (let i = 0; i < 40 && !bonus; i++) {
    const p = await rockPoint(page, rock, true);
    await page.mouse.move(p.x, p.y);
    await waitTicks(page, 3);
    bonus = await page.evaluate(() => window.__cinder!.sim.state.player.beams.some((b) => b.bonus > 1));
  }
  expect(bonus).toBe(true);
  await keepCharged(page);
  await waitFrames(page, 4);
  await shot(page, 'beam-vein-bonus');

  // near overheating: heat the lasers to 3.7 of 4 s
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    for (const l of p.props.lasers) p.heat.set(l.partId, { heat: 3.7, cooling: 0 });
  });
  await waitFrames(page, 3);
  await shot(page, 'beam-near-overheat');
  await page.waitForFunction(() => [...window.__cinder!.sim.state.player.heat.values()].some((h) => h.cooling > 0), undefined, { timeout: 30_000 }).catch(() => undefined);
  await waitFrames(page, 2);
  await shot(page, 'beam-overheated-smoke');

  // out of energy: the battery is empty, the lasers sputter
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.heat.clear();
    p.energy = 0;
  });
  await page.mouse.move(off.x, off.y);
  await waitFrames(page, 8);
  await shot(page, 'beam-out-of-energy');
  await page.mouse.up({ button: 'right' });

  // Low quality: no point light at the hit
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('low'));
  await waitFrames(page, 3);
  expect((await page.evaluate(() => window.__cinder!.renderer.miningStats())).lightsInScene).toBe(0);
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('medium'));
  await waitFrames(page, 3);
  expect((await page.evaluate(() => window.__cinder!.renderer.miningStats())).lightsInScene).toBe(1);
  expect(errors).toEqual([]);
});

test('Mining 2.0: nuggets – break off, fly-through pickup, tractor pickup', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await start(page);
  const rock = await parkAt(page);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -2400);
  await waitTicks(page, 20);

  // a nugget breaks off the rock (the sim rolls are rare – break one off like the sim does)
  await page.evaluate((id) => {
    const { sim, renderer } = window.__cinder!;
    const s = sim.state;
    const a = s.world.findAsteroid(id)!;
    const r = s.world.radiusOf(a);
    // on the side of the rock away from the ship (the magnet would take it at once)
    const n = { x: 0.15, y: 1 };
    const len = Math.hypot(n.x, n.y);
    const pos = { x: a.pos.x + (n.x / len) * (r + 0.6), y: a.pos.y + (n.y / len) * (r + 0.6) };
    const body = { pos, vel: { x: 0.2, y: 0.8 }, angle: 0, angVel: 2 };
    const nugget = { id: s.mining.nextId++, resource: a.resource, amount: 12.5, grade: 1.3, source: a.id, body, prevBody: body, ttl: 45 * 60 };
    s.mining.nuggets.push(nugget);
    renderer.onSimEvents([{ type: 'nuggetSpawned', id: nugget.id, pos, vel: body.vel, resource: a.resource, amount: 12.5, grade: 1.3 }]);
  }, rock);
  await waitFrames(page, 5);
  await shot(page, 'nugget-break-off');
  await waitTicks(page, 50);
  await expect(page.locator('[data-callout-id^="nugget:"]')).toBeVisible();
  await shot(page, 'nugget-drifting-callout');

  // fly-through: steer the nugget into the ship's path (the magnet takes it at the hull)
  const cargo0 = await page.evaluate(() => window.__cinder!.sim.state.player.cargo);
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    const n = s.mining.nuggets[0]!;
    const p = s.player.body.pos;
    n.body = { ...n.body, pos: { x: p.x + 4, y: p.y + 0.5 }, vel: { x: -1.5, y: 0 } };
    n.prevBody = n.body;
  });
  await page.waitForFunction(() => window.__cinder!.sim.state.mining.nuggets.length === 0, undefined, { timeout: 30_000 });
  await waitFrames(page, 3);
  await expect(page.getByTestId('hud-pop')).toBeVisible();
  await shot(page, 'nugget-pickup-flythrough');
  const cargo1 = await page.evaluate(() => window.__cinder!.sim.state.player.cargo);
  const gained = Object.values(cargo1).reduce((s, v) => s + v, 0) - Object.values(cargo0).reduce((s, v) => s + v, 0);
  expect(gained).toBeCloseTo(12.5, 1);

  // tractor beam: a nugget 11 u away, cursor on it, T
  const target = await page.evaluate((id) => {
    const { sim, renderer } = window.__cinder!;
    const s = sim.state;
    const a = s.world.findAsteroid(id)!;
    const p = s.player.body.pos;
    const pos = { x: p.x - 3, y: p.y + 11 };
    const body = { pos, vel: { x: 0.1, y: 0.05 }, angle: 0, angVel: 1.5 };
    s.mining.nuggets.push({ id: s.mining.nextId++, resource: a.resource, amount: 9, grade: 1.1, source: a.id, body, prevBody: body, ttl: 45 * 60 });
    return renderer.worldToScreen(pos);
  }, rock);
  await page.mouse.move(target.x, target.y);
  await waitTicks(page, 5);
  await page.keyboard.press('KeyT');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.tractor?.target.kind === 'nugget', undefined, { timeout: 10_000 });
  await waitTicks(page, 40);
  await shot(page, 'nugget-tractor-pull');
  await page.waitForFunction(() => window.__cinder!.sim.state.mining.nuggets.length === 0, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.tractor)).toBeNull();
  await waitFrames(page, 3);
  await shot(page, 'nugget-tractor-collected');
  expect(errors).toEqual([]);
});

test('Mining 2.0: ore assay – rich-rock callout, radar tint and the best grade on the map', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await start(page);
  // a rich rock near the start
  const rich = await page.evaluate(async (path) => {
    const Gr = (await import(path)) as Grade;
    const { sim } = window.__cinder!;
    const s = sim.state;
    for (const r of [80, 200, 400]) {
      s.world.update({ x: 0, y: 0 });
      const found = s.world
        .asteroids()
        .filter((a) => Math.hypot(a.pos.x, a.pos.y) < r + 200 && Math.hypot(a.pos.x, a.pos.y) > 90 && Gr.isRich(Gr.oreGrade(s.seed, a)))
        .sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0];
      if (found) return { id: found.id, grade: Gr.oreGrade(s.seed, found) };
    }
    return null;
  }, MOD.grade);
  expect(rich).not.toBeNull();
  await parkAt(page, rich!.id);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -1200);
  await waitTicks(page, 20);

  // before the pulse the rock under the beam says "?"
  const p = await rockPoint(page, rich!.id, false);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: 'right' });
  await waitTicks(page, 20);
  await expect(page.getByTestId(`callout-ore:${rich!.id}`)).toContainText('Kvalita ?');
  await shot(page, 'grade-unknown');
  await page.mouse.up({ button: 'right' });

  // Tab tap = pulse → assay
  await page.keyboard.down('Tab');
  await waitTicks(page, 4);
  await page.keyboard.up('Tab');
  await waitTicks(page, 10);
  expect(await page.evaluate(() => window.__cinder!.sim.state.mining.assayed.size)).toBeGreaterThan(0);
  const pct = `${Math.round(rich!.grade * 100)} %`;
  await expect(page.getByTestId(`callout-ore:${rich!.id}`)).toContainText(pct);
  await expect(page.getByTestId(`callout-ore:${rich!.id}`)).toContainText('Bohatá ruda');
  await waitFrames(page, 3);
  await shot(page, 'grade-rich-callout-radar');

  // the map remembers the field's best grade
  await page.keyboard.press('KeyM');
  await waitFrames(page, 4);
  await shot(page, 'map-best-grade');
  await page.keyboard.press('KeyM');
  expect(errors).toEqual([]);
});
