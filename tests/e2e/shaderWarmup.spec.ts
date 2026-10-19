import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { approachClamp } from './dockHelper';
import { loadFixture, type FixtureName } from './fixtures';

// Shader warm-up (audit 2026-10-16, issue #1; src/render/warmup.ts): before the first game frame the
// renderer compiles the scene plus a zoo of every runtime material variant, so a scripted session –
// fly, mine, fight, salvage, dock – creates no new shader program (a new program = a compile freeze
// the first time an effect shows up). The count is read after the first frames (the post passes of
// the first frame are part of the baseline) and must not change until the end of the session.

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 60_000 });
}

const programs = (page: Page): Promise<number> => page.evaluate(() => window.__cinder!.renderer.shaderPrograms());

/** Holds keys for `ticks` simulation steps. */
async function hold(page: Page, keys: string[], ticks: number): Promise<void> {
  for (const k of keys) await page.keyboard.down(k);
  await waitTicks(page, ticks);
  for (const k of keys) await page.keyboard.up(k);
}

/** Points the mouse at a point of the gameplay plane. */
async function aimAt(page: Page, p: { x: number; y: number }): Promise<void> {
  const s = await page.evaluate((q) => window.__cinder!.renderer.worldToScreen(q), p);
  await page.mouse.move(s.x, s.y);
}

/** Every effect of a fight's events at the player (explosions with debris, hits on hull and shield, a rock breaking up). */
async function fightEffects(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { sim, renderer } = window.__cinder!;
    const p = sim.state.player;
    const pos = { x: p.body.pos.x + 6, y: p.body.pos.y + 4 };
    const rock = sim.state.world.asteroids()[0];
    const events = [
      { type: 'shotFired', pos, dir: { x: 1, y: 0 }, owner: 'pirate' },
      { type: 'projectileHit', pos, from: p.body.pos, target: 'ship', ref: 'none' },
      { type: 'projectileHit', pos, from: p.body.pos, target: 'asteroid' },
      { type: 'partDestroyed', ref: 'none', pos },
      { type: 'shipDestroyed', ref: 'none', pos, vel: { x: 0, y: 0 }, radius: 3 },
      // M4c: a large reactor's blast (fx/Effects.ts reactorBlast)
      { type: 'partBlast', ref: 'none', partId: 0, pos, damage: 40 },
      { type: 'collision', pos, speed: 20 },
      // M4b micrometeor grains on the hull and on the shield (render/fx/Micrometeors.ts)
      { type: 'micrometeorHit', pos, partId: 0, damage: 2, shielded: false },
      { type: 'micrometeorHit', pos, partId: 0, damage: 2, shielded: true },
      ...(rock ? [{ type: 'asteroidDepleted', id: rock.id }] : []),
    ];
    renderer.onSimEvents(events as never);
  });
}

const sessions: { name: string; fixture: FixtureName; quality?: 'high'; run: (page: Page) => Promise<void> }[] = [
  {
    name: 'undock and fly',
    fixture: 'hour2',
    run: async (page) => {
      await page.getByTestId('undock').click();
      await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', undefined, { timeout: 30_000 });
      await hold(page, ['KeyW'], 120);
      await hold(page, ['KeyA'], 40);
      await hold(page, ['KeyW', 'KeyQ'], 90);
      await hold(page, ['KeyS'], 60);
    },
  },
  {
    name: 'mine the rich rock',
    fixture: 'rich-rock',
    run: async (page) => {
      const rock = await page.evaluate(() => window.__cinder!.sim.state.world.findAsteroid('0,-1:3')?.pos ?? null);
      expect(rock).not.toBeNull();
      await aimAt(page, rock!);
      await page.mouse.down({ button: 'right' });
      await waitTicks(page, 240);
      await page.mouse.up({ button: 'right' });
      await waitTicks(page, 30);
    },
  },
  {
    name: 'fight the pirates',
    fixture: 'pirates-near',
    run: async (page) => {
      const foe = await page.evaluate(() => window.__cinder!.sim.state.combat.enemies[0]?.body.pos ?? null);
      if (foe) await aimAt(page, foe);
      await page.mouse.down({ button: 'left' });
      await hold(page, ['KeyW'], 60);
      await fightEffects(page);
      await waitTicks(page, 180);
      await page.mouse.up({ button: 'left' });
    },
  },
  {
    name: 'scan and salvage the wreck',
    fixture: 'wreck-salvage',
    run: async (page) => {
      await page.keyboard.press('Tab');
      await waitTicks(page, 60);
      await page.keyboard.press('KeyF');
      await waitTicks(page, 240);
      await hold(page, ['Tab'], 90);
    },
  },
  {
    name: 'dock and undock',
    fixture: 'dock-approach',
    run: async (page) => {
      await approachClamp(page, { stationId: 'home' });
      await waitTicks(page, 10);
      await page.keyboard.press('KeyF');
      await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'docked', undefined, { timeout: 30_000 });
      await waitTicks(page, 60);
      await page.getByTestId('undock').click();
      await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', undefined, { timeout: 30_000 });
      await waitTicks(page, 60);
    },
  },
  {
    // the far tier (render/env/ShadowRig.ts): wrecks, sleepers and scatter stop casting and leave the AO
    // pass far out, and come back zoomed in – flags only, no program variant
    name: 'graveyard far tier out and back',
    fixture: 'graveyard',
    // shadows and AO on (the far tier works on the shadow sweep)
    quality: 'high',
    run: async (page) => {
      const zoom = (d: number) => page.evaluate((v) => ((window.__cinder!.renderer as unknown as { rig: { distance: number } }).rig.distance = v), d);
      const far = () => page.evaluate(() => (window.__cinder!.renderer as unknown as { shadows: { far: boolean } }).shadows.far);
      await waitTicks(page, 60);
      await zoom(140);
      await page.waitForFunction(() => (window.__cinder!.renderer as unknown as { shadows: { far: boolean } }).shadows.far, undefined, { timeout: 30_000 });
      await waitTicks(page, 60);
      await zoom(48);
      await page.waitForFunction(() => !(window.__cinder!.renderer as unknown as { shadows: { far: boolean } }).shadows.far, undefined, { timeout: 30_000 });
      await waitTicks(page, 60);
      expect(await far()).toBe(false);
    },
  },
];

for (const s of sessions) {
  test(`no new shader program after the warm-up: ${s.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (s.quality) await page.addInitScript((q) => localStorage.setItem('cinderbelt.settings', JSON.stringify({ graphicsQuality: q })), s.quality);
    await loadFixture(page, s.fixture, { ticks: 20 });
    const report = await page.evaluate(() => (window.__cinder!.game as unknown as { warmUpReport: { programs: number; samples: number } | null }).warmUpReport);
    expect(report?.samples ?? 0).toBeGreaterThan(50);
    const before = await programs(page);
    await s.run(page);
    await waitTicks(page, 20);
    expect(await programs(page)).toBe(before);
  });
}

// M4a hangar hall (plan T8): ships stored at the station park on the bay deck (render/ParkedShips.ts),
// and a ship switch rebuilds the flight and the editor ship. Driven by a stand-in fleet; `switchShip`
// does to the render-visible state what the sim's swap does (grid, props, gridVersion).

type GridModule = typeof import('../../src/sim/ship/grid');
type PresetsModule = typeof import('../../src/sim/ship/presets');
type PropertiesModule = typeof import('../../src/sim/ship/properties');
type ConnectorsModule = typeof import('../../src/render/connectors');
type OutlineModule = typeof import('../../src/sim/ship/outline');
type ShellSettingModule = typeof import('../../src/render/hull/setting');
const MODULES = {
  grid: '/src/sim/ship/grid.ts',
  presets: '/src/sim/ship/presets.ts',
  properties: '/src/sim/ship/properties.ts',
  connectors: '/src/render/connectors.ts',
  outline: '/src/sim/ship/outline.ts',
  shellSetting: '/src/render/hull/setting.ts',
};

const frames = (page: Page, n = 4) =>
  page.evaluate(
    (k) =>
      new Promise((resolve) => {
        let i = 0;
        const f = () => (++i >= k ? resolve(null) : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

/** Median draw calls of a few frames. */
const drawCalls = (page: Page) =>
  page.evaluate(async () => {
    const r = window.__cinder!.renderer as unknown as { renderer: { info: { render: { calls: number } } } };
    const list: number[] = [];
    await new Promise<void>((resolve) => {
      let n = 0;
      const f = () => {
        if (n++ > 2) list.push(r.renderer.info.render.calls);
        if (n < 10) requestAnimationFrame(f);
        else resolve();
      };
      requestAnimationFrame(f);
    });
    return list.sort((a, b) => a - b)[list.length >> 1]!;
  });

const geometries = (page: Page) =>
  page.evaluate(() => (window.__cinder!.renderer as unknown as { renderer: { info: { memory: { geometries: number } } } }).renderer.info.memory.geometries);

const parked = (page: Page) => page.evaluate(() => window.__cinder!.renderer.hangar.parkedStats());

/**
 * Stand-in ships stored at the docked station: starter, fighter, hauler, scout (the first `count`).
 * With the hangar open, waits until the hall shows them.
 */
async function parkShips(page: Page, count: number, hangarOpen = true): Promise<void> {
  await page.evaluate(
    async ({ n, modules }) => {
      const { createGrid } = (await import(/* @vite-ignore */ modules.grid)) as GridModule;
      const { createStarterShip } = (await import(/* @vite-ignore */ modules.presets)) as PresetsModule;
      type Row = Parameters<GridModule['createGrid']>[0][number];
      const fighter: Row[] = [
        ['cockpit', 2, 0], ['cannon', 3, 0], ['cannon', 2, 1], ['cannon', 2, -1], ['shield', 1, 0], ['gyro', 0, 0], ['reactor', -1, 0],
        ['armor', 1, 1, 0, 2], ['armor', 1, -1, 0, 2], ['battery', 0, 1], ['battery', 0, -1], ['engine', -2, 0], ['engine', -1, 1], ['engine', -1, -1],
      ];
      const hauler: Row[] = [['cockpit', 4, 0], ['radar', 3, 1], ['miningLaser', 4, 1], ['miningLaser', 4, -1]];
      for (let x = -3; x <= 3; x++) for (let y = -2; y <= 2; y++) if (!(x === 3 && y === 1)) hauler.push([x === 0 && y === 0 ? 'reactor' : 'cargo', x, y, 0, (x + y) % 2 === 0 ? 2 : 1]);
      for (let y = -2; y <= 2; y++) hauler.push(['engine', -4, y]);
      const scout: Row[] = [['cockpit', 5, 0], ['radar', 4, 0], ['gyro', -2, 0], ['engine', -4, 0], ['engine', -3, 1], ['engine', -3, -1], ['tractorBeam', 5, 1]];
      for (let x = -3; x <= 3; x++) if (x !== -2) scout.push(['fuelTank', x, 0]);
      const grids = [createStarterShip(), createGrid(fighter), createGrid(hauler), createGrid(scout)];
      const st = window.__cinder!.sim.state;
      const dock = st.player.dock;
      st.fleet.stored = grids.slice(0, n).map((grid, i) => ({
        record: { id: 2 + i, name: null, nameIdx: i, log: { distance: 0, kills: 0, mined: 0, deaths: 0, built: 0 } },
        stationId: dock.mode === 'flying' ? 'home' : dock.stationId,
        grid,
        blueprint: grid,
        hp: new Map(),
        fuel: 0,
        cargo: {},
      })) as typeof st.fleet.stored;
    },
    { n: count, modules: MODULES },
  );
  if (hangarOpen) await page.waitForFunction((n) => window.__cinder!.renderer.hangar.parkedStats().ships === n, count);
  await frames(page);
}

/** The active ship and the first stored ship trade places (what a hangar switch does to the render state). */
async function switchShip(page: Page): Promise<void> {
  await page.evaluate(async (modules) => {
    const { computeProperties } = (await import(/* @vite-ignore */ modules.properties)) as PropertiesModule;
    const st = window.__cinder!.sim.state;
    const p = st.player;
    const other = st.fleet.stored[0]!;
    const grid = other.grid;
    st.fleet.stored = [{ ...other, grid: p.grid, blueprint: p.grid }];
    p.grid = grid;
    p.blueprint = grid;
    p.props = computeProperties(grid);
    p.gridVersion++;
  }, MODULES);
  await frames(page, 6);
}

/**
 * Parts of the active grid and hull connectors of the flight ship view (built from that grid?). With the
 * hull shell on (SL2 E1) the connectors are the corner hubs of the outline, without it the dot grid.
 */
const flightShip = (page: Page) =>
  page.evaluate(async (modules) => {
    const { connectorPlacements } = (await import(/* @vite-ignore */ modules.connectors)) as ConnectorsModule;
    const { hullOutline } = (await import(/* @vite-ignore */ modules.outline)) as OutlineModule;
    const { hullShellEnabled } = (await import(/* @vite-ignore */ modules.shellSetting)) as ShellSettingModule;
    const view = (window.__cinder!.renderer as unknown as { shipView: { connectorCount: number } }).shipView;
    const grid = window.__cinder!.sim.state.player.grid;
    const expected = hullShellEnabled() ? hullOutline(grid, { tornFrom: null, bevelArmour: true }).hubs.length : connectorPlacements(grid).length;
    return { connectors: view.connectorCount, expected, parts: grid.parts.length };
  }, MODULES);

const yardParts = (page: Page) =>
  page.evaluate(() => (window.__cinder!.game as unknown as { yard: { draft: { grid: { parts: unknown[] } } } | null }).yard?.draft.grid.parts.length ?? 0);

/** Opens a station tab and lets the scene draw. */
async function tab(page: Page, name: 'overview' | 'shipyard'): Promise<void> {
  if (name === 'shipyard') await page.keyboard.press('Digit4');
  else await page.getByTestId('tab-overview').click();
  await expect(page.getByTestId('shipyard')).toBeVisible({ visible: name === 'shipyard' });
  await frames(page, 10);
}

/**
 * One round of switching: to the stored fighter while docked (the dock scene shows it at once), the
 * editor opens on it, back to the starter with the editor open (an unedited draft follows), back to
 * the hub.
 */
async function switchRound(page: Page, starterParts: number, programsBefore: number): Promise<void> {
  await parkShips(page, 2, false);
  await page.evaluate(() => {
    const st = window.__cinder!.sim.state;
    st.fleet.stored = [st.fleet.stored[1]!];
  });
  await switchShip(page);
  const flown = await flightShip(page);
  expect(flown.parts).toBe(14);
  expect(flown.connectors).toBe(flown.expected);
  expect(await programs(page)).toBe(programsBefore);
  await tab(page, 'shipyard');
  expect(await yardParts(page)).toBe(14);
  expect(await programs(page)).toBe(programsBefore);
  await switchShip(page);
  await page.waitForFunction((n) => (window.__cinder!.game as unknown as { yard: { draft: { grid: { parts: unknown[] } } } }).yard.draft.grid.parts.length === n, starterParts);
  await tab(page, 'overview');
  const back = await flightShip(page);
  expect(back.parts).toBe(starterParts);
  expect(back.connectors).toBe(back.expected);
  await page.evaluate(() => {
    window.__cinder!.sim.state.fleet.stored = [];
  });
  await frames(page, 10);
  expect(await programs(page)).toBe(programsBefore);
}

test('no new shader program or leak: a ship switch rebuilds the dock scene and the editor ship', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 90_000 });
  await expect(page.getByTestId('station-hub')).toBeVisible();
  // the hangar scene is part of the warm-up (SL2 E1 T11): its first opening compiles nothing either
  const before = await programs(page);
  await tab(page, 'shipyard');
  await tab(page, 'overview');
  expect(await programs(page)).toBe(before);
  const starterParts = await page.evaluate(() => window.__cinder!.sim.state.player.grid.parts.length);
  await switchRound(page, starterParts, before);
  // the editor keeps a few caches by key (labels, arcs) – a second round must not add anything
  const geometriesAfterOne = await geometries(page);
  await switchRound(page, starterParts, before);
  expect(await geometries(page)).toBe(geometriesAfterOne);
  expect(errors).toEqual([]);
});

test('no new shader program or leak: ships parked in the hangar hall, within the draw-call budget', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 90_000 });
  await expect(page.getByTestId('station-hub')).toBeVisible();
  // the bay (whose deck the ships stand on) is left out on the software preset
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('medium'));
  await tab(page, 'shipyard');
  await page.waitForFunction(() => window.__cinder!.renderer.hangar.bayStats().loaded, undefined, { timeout: 60_000 });
  // zoomed out from the top: all four spots in view
  await page.evaluate(() => Object.assign(window.__cinder!.renderer.hangar.view.goal, { pitch: Math.PI / 2, zoom: 0.6 }));
  await frames(page, 30);
  const before = await programs(page);
  const baseGeometries = await geometries(page);
  const baseCalls = await drawCalls(page);

  // four parked ships: nothing compiles, at most two draw calls each, no rebuild while nothing changes
  await parkShips(page, 4);
  expect(await parked(page)).toMatchObject({ ships: 4, visible: true });
  expect(await programs(page)).toBe(before);
  expect((await drawCalls(page)) - baseCalls).toBeLessThanOrEqual(2 * 4);
  const builds = (await parked(page)).builds;
  await frames(page, 10);
  expect((await parked(page)).builds).toBe(builds);

  // the hall empties: every parked ship's geometry is gone
  await parkShips(page, 0);
  await frames(page, 6);
  expect(await geometries(page)).toBe(baseGeometries);
  expect(await programs(page)).toBe(before);
  expect(errors).toEqual([]);
});
