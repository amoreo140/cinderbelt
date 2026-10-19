import { expect, test, type Page } from '@playwright/test';
import { loadFixture, type FixtureName } from './fixtures';

// SL2 E1 T6 – the hull shell in a fight (SL2 E1 hull shell):
// pirates and wrecks rebuild through the rebuild queue (≤ 1 per frame, nearest first), the shell adds
// no draw call per ship (+1 in total: the nav lights), no shader program appears mid-fight or when the
// shell setting is toggled, and a pirate's shell builds within its budget. Frame times are recorded;
// the "no frame > 50 ms" gate applies only on a real GPU (the e2e browser renders in software).
// Screenshots (a pirate losing parts, the 5-pirate fight at 48 and 100) go to HULL_SHOT_DIR.

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SHOTS = env.HULL_SHOT_DIR ?? null;

const MODULES = {
  enemies: '/src/sim/combat/enemies.ts',
  properties: '/src/sim/ship/properties.ts',
  grid: '/src/sim/ship/grid.ts',
  setting: '/src/render/hull/setting.ts',
  shipView: '/src/render/ShipView.ts',
} as const;
type EnemiesModule = typeof import('../../src/sim/combat/enemies');
type PropertiesModule = typeof import('../../src/sim/ship/properties');
type GridModule = typeof import('../../src/sim/ship/grid');
type SettingModule = typeof import('../../src/render/hull/setting');
type ShipViewModule = typeof import('../../src/render/ShipView');

type CombatStats = {
  enemies: number;
  wrecks: number;
  rebuildsPending: number;
  rebuildsDone: number;
  ships: { id: string; wreck: boolean; navPoints: number; shell: { on: boolean; tornEdges: number; shellMs: number; buildMs: number } }[];
};
const combatStats = (page: Page) => page.evaluate(() => (window.__cinder!.renderer as unknown as { combatStats(): CombatStats }).combatStats());
const programs = (page: Page) => page.evaluate(() => window.__cinder!.renderer.shaderPrograms());


async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 90_000 });
}

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

const setShell = (page: Page, on: boolean) =>
  page.evaluate(
    async ({ on, modules }) => {
      const { setHullShellEnabled } = (await import(/* @vite-ignore */ modules.setting)) as SettingModule;
      setHullShellEnabled(on);
    },
    { on, modules: MODULES },
  );

const setZoom = (page: Page, d: number) =>
  page.evaluate((v) => {
    (window.__cinder!.renderer as unknown as { rig: { distance: number } }).rig.distance = v;
  }, d);

const hideUi = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    document.getElementById('ui')!.style.display = h ? 'none' : '';
  }, hidden);

const setPaused = (page: Page, paused: boolean) =>
  page.evaluate((p) => (window.__cinder!.game as unknown as { setPaused(p: boolean): void }).setPaused(p), paused);

/**
 * The fight: the world's pirates leave, `kinds` spawn in a ring `radius` around the player (attacking;
 * `frozen` = no engines), and the player's shield is made big enough to outlast them.
 */
async function arena(page: Page, kinds: string[], radius: number, frozen: boolean): Promise<string[]> {
  return page.evaluate(
    async ({ kinds, radius, frozen, modules }) => {
      const { createEnemy } = (await import(/* @vite-ignore */ modules.enemies)) as EnemiesModule;
      const { sim } = window.__cinder!;
      const { combat, player } = sim.state;
      for (const e of combat.enemies) combat.defeated.set(e.id, sim.state.tick);
      combat.enemies = [];
      combat.projectiles = [];
      player.props = { ...player.props, shield: { ...player.props.shield, capacity: 1e6, regen: 1e5, regenDelay: 0, energyPerPoint: 0 } };
      player.shield = 1e6;
      const c = player.body.pos;
      return kinds.map((kind, i) => {
        const a = (i / kinds.length) * Math.PI * 2 + 0.4;
        const pos = { x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius };
        const e = createEnemy({ id: `pr:perf:${i}`, kind: kind as never, tier: 1, pos, angle: a + Math.PI, home: pos, orbit: 1 });
        if (frozen) e.props = { ...e.props, thrust: { forward: 0, backward: 0, left: 0, right: 0 }, torque: 0 };
        e.ai.mode = 'attack';
        combat.enemies.push(e);
        return e.id;
      });
    },
    { kinds, radius, frozen, modules: MODULES },
  );
}

/** Shoots `n` outer parts (never the cockpit) off each of the pirates at once – what a hit does to the render state. */
async function shootOff(page: Page, ids: string[], n: number): Promise<void> {
  await page.evaluate(
    async ({ ids, n, modules }) => {
      const { computeProperties } = (await import(/* @vite-ignore */ modules.properties)) as PropertiesModule;
      const { combat } = window.__cinder!.sim.state;
      for (const e of combat.enemies) {
        if (!ids.includes(e.id)) continue;
        // the parts farthest from the cockpit go first
        const cockpit = e.grid.parts.find((p) => p.partId === 'cockpit')!;
        const far = e.grid.parts
          .filter((p) => p !== cockpit)
          .sort((a, b) => Math.hypot(b.x - cockpit.x, b.y - cockpit.y) - Math.hypot(a.x - cockpit.x, a.y - cockpit.y))
          .slice(0, n);
        e.grid = { parts: e.grid.parts.filter((p) => !far.includes(p)), nextId: e.grid.nextId };
        const props = computeProperties(e.grid);
        e.props = { ...props, thrust: e.props.thrust, torque: e.props.torque };
        e.gridVersion++;
      }
    },
    { ids, n, modules: MODULES },
  );
}

/** Frame times for `ms` (rAF deltas, the first two dropped). */
const frameTimes = (page: Page, ms: number) =>
  page.evaluate(
    (dur) =>
      new Promise<{ frames: number; avg: number; p95: number; max: number; over50: number }>((resolve) => {
        const dts: number[] = [];
        let last = 0;
        const t0 = performance.now();
        const f = (t: number) => {
          if (last > 0) dts.push(t - last);
          last = t;
          if (t - t0 < dur) requestAnimationFrame(f);
          else {
            const d = dts.slice(2).sort((a, b) => a - b);
            const avg = d.reduce((s, x) => s + x, 0) / Math.max(1, d.length);
            resolve({ frames: d.length, avg, p95: d[Math.floor(d.length * 0.95)] ?? 0, max: d[d.length - 1] ?? 0, over50: d.filter((x) => x > 50).length });
          }
        };
        requestAnimationFrame(f);
      }),
    ms,
  );

const softwareGpu = (page: Page) => page.evaluate(() => (window.__cinder!.renderer as unknown as { softwareGpu: boolean }).softwareGpu);

test('hull shell perf: a pirate and a 140-cell hull build within budget', async ({ page }) => {
  test.setTimeout(120_000);
  await loadFixture(page, 'pirates-near', { ticks: 10 });
  const timing = await page.evaluate(async (modules) => {
    const { ENEMY_TEMPLATES } = (await import(/* @vite-ignore */ modules.enemies)) as EnemiesModule;
    const { createGrid } = (await import(/* @vite-ignore */ modules.grid)) as GridModule;
    const r = window.__cinder!.renderer;
    type Row = Parameters<GridModule['createGrid']>[0][number];
    // a 14 × 10 freighter-like hull (shellGeometry.test.ts bigShip, simplified): 140 cells
    const rows: Row[] = [];
    const fill = ['armor', 'reactor', 'fuelTank', 'armor', 'gyro', 'battery', 'armor', 'shield', 'radar', 'armor'];
    let k = 0;
    for (let x = -7; x <= 6; x++) {
      for (let y = -5; y <= 4; y++) {
        if (x === 6 && y === 0) rows.push(['cockpit', x, y, 0, 2]);
        else if (x === -7) rows.push(['engine', x, y, 0, 2]);
        else if (x === 6 && Math.abs(y) % 3 === 1) rows.push(['cannon', x, y, 0, 2]);
        else if (y === -5 || y === 4) rows.push(['armor', x, y, 0, 2]);
        else rows.push([fill[k++ % fill.length] as Row[0], x, y, 0, 2]);
      }
    }
    const big = createGrid(rows);
    const pirates = (['jackal', 'hammer', 'gunner'] as const).map((kind) => ({
      kind,
      cells: ENEMY_TEMPLATES[kind](2).parts.length,
      ...r.measureShellBuild(ENEMY_TEMPLATES[kind](2), 'rust', 30),
    }));
    return { pirates, big: { cells: big.parts.length, ...r.measureShellBuild(big, null, 15) } };
  }, MODULES);
  console.log('[hull shell perf] build timing (median, ms):', JSON.stringify(timing));
  for (const p of timing.pirates) {
    expect(p.pieces).toBeGreaterThan(0);
    // spec budget 0.3 ms per pirate shell; the e2e browser shares the CPU with other workers – a margin
    expect(p.shellMs).toBeLessThanOrEqual(0.6);
  }
  expect(timing.big.cells).toBe(140);
  expect(timing.big.shellMs).toBeLessThanOrEqual(4);
});

test('hull shell perf: 5-pirate fight – rebuild queue, draw calls on vs off, no new program', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // pirates have no nav lights on Low (the software GPU's preset): Medium from the start, so the
  // warm-up compiles for it
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ graphicsQuality: 'medium' })));
  await loadFixture(page, 'pirates-near', { ticks: 20 });
  expect(await page.evaluate(() => window.__cinder!.renderer.graphicsQuality.level)).toBe('medium');
  const before = await programs(page);
  const ids = await arena(page, ['jackal', 'hammer', 'jackal', 'hammer', 'jackal'], 20, false);
  await setZoom(page, 48);
  await waitTicks(page, 60);
  let s = await combatStats(page);
  expect(s.enemies).toBe(5);
  for (const ship of s.ships.filter((x) => !x.wreck)) {
    expect(ship.shell.on).toBe(true);
    expect(ship.navPoints).toBeGreaterThan(0);
  }
  const lights = await page.evaluate(() => (window.__cinder!.renderer as unknown as { navLightCount(): number }).navLightCount());
  expect(lights).toBeGreaterThan(5 * 3);

  // every pirate loses parts in the same step: one rebuild per frame, the old hulls meanwhile
  const done0 = s.rebuildsDone;
  const fight = frameTimes(page, 6000);
  await shootOff(page, ids, 2);
  const queued = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const r = window.__cinder!.renderer as unknown as { combatStats(): CombatStats };
        const seen: number[] = [];
        const f = () => {
          seen.push(r.combatStats().rebuildsPending);
          if (seen.length < 8) requestAnimationFrame(f);
          else resolve(seen);
        };
        requestAnimationFrame(f);
      }),
  );
  console.log('[hull shell perf] pending rebuilds per frame after the volley:', queued.join(' '));
  expect(Math.max(...queued)).toBeLessThanOrEqual(4);
  expect(queued[queued.length - 1]).toBe(0);
  const stats = await fight;
  s = await combatStats(page);
  expect(s.rebuildsDone - done0).toBeGreaterThanOrEqual(5);
  const torn = s.ships.filter((x) => !x.wreck && ids.includes(x.id));
  for (const ship of torn) expect(ship.shell.tornEdges).toBeGreaterThan(0);
  const shellMs = torn.map((x) => x.shell.shellMs).sort((a, b) => a - b);
  const gpu = await softwareGpu(page);
  console.log('[hull shell perf] 5-pirate fight frames:', JSON.stringify({ ...stats, softwareGpu: gpu, shellMs }));
  if (!gpu) expect(stats.over50).toBe(0);

  if (SHOTS) {
    await hideUi(page, true);
    await setPaused(page, true);
    await frames(page, 6);
    await page.screenshot({ path: `${SHOTS}/fight5-48.png` });
    await setZoom(page, 100);
    await frames(page, 30);
    await page.screenshot({ path: `${SHOTS}/fight5-100.png` });
    await setZoom(page, 48);
    await setPaused(page, false);
    await hideUi(page, false);
  }

  // shell on vs off, sim halted so nothing moves between the counts: +1 draw call (nav lights) at most
  await setPaused(page, true);
  // the bolts and explosions of the fight burn out first (their draw calls are not the shell's)
  await page.evaluate(() => {
    window.__cinder!.sim.state.combat.projectiles = [];
  });
  await page.waitForFunction(() => (window.__cinder!.renderer as unknown as { combatStats(): { effects: number } }).combatStats().effects === 0, undefined, { timeout: 90_000 });
  const shells = (on: boolean) =>
    page.waitForFunction(
      (want) => (window.__cinder!.renderer as unknown as { combatStats(): CombatStats }).combatStats().ships.every((x) => x.shell.on === want),
      on,
      { timeout: 30_000 },
    );
  // the camera settles first (the screenshots' zoom, the combat zoom-out)
  await page.waitForTimeout(3000);
  // the draw calls of the game frame itself, read right after its post chain (other renders that share
  // the WebGL renderer between frames – HUD views – would add to `info` otherwise)
  await page.evaluate(() => {
    const r = window.__cinder!.renderer as unknown as { renderer: { info: { render: { calls: number } } }; post: { render(dt: number): void } };
    const post = r.post;
    const original = post.render.bind(post);
    const w = window as unknown as { __frameCalls: number };
    post.render = (dt: number) => {
      original(dt);
      w.__frameCalls = r.renderer.info.render.calls;
    };
  });
  // a halted game redraws twice a second: each count waits for a redraw after the change (the views
  // rebuild and bake), tags the new meshes as shadow casters (the renderer's sweep runs every 8th
  // frame – seconds while halted) and waits for one more redraw
  const count = async (shell: boolean) => {
    await setShell(page, shell);
    await shells(shell);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const r = window.__cinder!.renderer as unknown as { shadows: { tagNow(root: unknown): void }; scene: unknown };
      r.shadows.tagNow(r.scene);
    });
    await page.waitForTimeout(1200);
    return page.evaluate(() => (window as unknown as { __frameCalls: number }).__frameCalls);
  };
  const off = await count(false);
  const on = await count(true);
  const offAgain = await count(false);
  const onAgain = await count(true);
  console.log('[hull shell perf] draw calls shell off / on / off / on:', off, on, offAgain, onAgain);
  // +1 at most: the nav light layer; the shell pieces merge into the hull batches
  for (const [a, b] of [[off, on], [offAgain, onAgain]] as const) {
    expect(b - a).toBeGreaterThanOrEqual(0);
    expect(b - a).toBeLessThanOrEqual(1);
  }
  await setPaused(page, false);
  await waitTicks(page, 30);
  expect(await programs(page)).toBe(before);
  expect(errors).toEqual([]);
});

/** One hull as a ShipView builds it: draw calls, batches, triangles drawn, connectors, shell triangles. */
type HullCount = { calls: number; batches: number; triangles: number; connectors: number; shellTriangles: number };

// SL2 E2 R4 (shaped parts, perf): shaped plates are
// runtime geometry inside the armour batch – a shaped ship draws with exactly the calls of the
// unshaped ship on the same cells, its shell builds within the E1 budget and the fight compiles nothing.
test('hull shell perf: the shaped fighter (shapes-fight) – +0 draw calls against its unshaped twin, no new program', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ graphicsQuality: 'medium' })));
  await loadFixture(page, 'shapes-fight' as FixtureName, { ticks: 20 });
  const before = await programs(page);
  const report = await page.evaluate(async (modules) => {
    const { ShipView } = (await import(/* @vite-ignore */ modules.shipView)) as ShipViewModule;
    const { computeProperties } = (await import(/* @vite-ignore */ modules.properties)) as PropertiesModule;
    const { partCells } = (await import(/* @vite-ignore */ modules.grid)) as GridModule;
    type Grid = Parameters<PropertiesModule['computeProperties']>[0];
    type Library = ConstructorParameters<ShipViewModule['ShipView']>[2];
    const r = window.__cinder!.renderer as unknown as { library: Library; measureShellBuild(g: Grid, clan: null, runs: number): { shellMs: number; buildMs: number; bakeMs: number; triangles: number } };
    const grid = window.__cinder!.sim.state.player.grid as Grid;
    // the twin: every shaped armour laid as full plates on the cells of its footprint
    let id = 0;
    const parts: Grid['parts'][number][] = [];
    for (const p of grid.parts) {
      if (p.shape === undefined) {
        parts.push({ ...p, id: ++id });
        continue;
      }
      const { shape: _shape, ...plain } = p;
      for (const c of partCells(p)) parts.push({ ...plain, id: ++id, x: c.x, y: c.y });
    }
    const twin: Grid = { parts, nextId: id + 1 };
    const count = (g: Grid, shell: boolean): HullCount => {
      const view = new ShipView(g, computeProperties(g), r.library, null, { shell, mode: 'flight' });
      view.bake();
      const out: HullCount = { calls: 0, batches: view.batchCount, triangles: 0, connectors: view.connectorCount, shellTriangles: view.shellInfo.triangles };
      view.group.traverse((o) => {
        const m = o as unknown as { isMesh?: boolean; isInstancedMesh?: boolean; visible: boolean; name: string; count: number; geometry: { index: { count: number } | null; getAttribute(n: string): { count: number } } };
        if (!m.isMesh || !m.visible || m.name === 'hull-decals') return;
        out.calls++;
        const n = (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
        out.triangles += n * (m.isInstancedMesh ? m.count : 1);
      });
      view.dispose();
      return out;
    };
    return {
      shapedParts: grid.parts.filter((p) => p.shape !== undefined).length,
      cells: parts.length,
      on: { shaped: count(grid, true), twin: count(twin, true) },
      off: { shaped: count(grid, false), twin: count(twin, false) },
      timing: r.measureShellBuild(grid, null, 30),
    };
  }, MODULES);
  console.log('[hull shell perf] shaped fighter vs unshaped twin:', JSON.stringify(report));
  expect(report.shapedParts).toBeGreaterThanOrEqual(6);
  // +0 draw calls: the plates join the armour batch, shell on and off
  for (const side of [report.on, report.off]) {
    expect(side.shaped.calls).toBe(side.twin.calls);
    expect(side.shaped.batches).toBe(side.twin.batches);
  }
  // E1 budgets: ≤ 4 000 shell triangles per ship, shell build ≤ 0.3 ms per ≤ 30-cell ship (2× margin
  // for the shared e2e CPU, as the pirate case above)
  expect(report.on.shaped.shellTriangles).toBeLessThanOrEqual(4000);
  expect(report.timing.shellMs).toBeLessThanOrEqual(0.6);

  // the fight: the Jackals close in, the player view draws its shaped hull; shell off vs on in the game frame
  await setZoom(page, 48);
  const fight = await frameTimes(page, 4000);
  const gpu = await softwareGpu(page);
  console.log('[hull shell perf] shaped fighter fight frames:', JSON.stringify({ ...fight, softwareGpu: gpu }));
  if (!gpu) expect(fight.over50).toBe(0);
  await setPaused(page, true);
  await page.evaluate(() => {
    window.__cinder!.sim.state.combat.projectiles = [];
  });
  await page.waitForFunction(() => (window.__cinder!.renderer as unknown as { combatStats(): { effects: number } }).combatStats().effects === 0, undefined, { timeout: 90_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const r = window.__cinder!.renderer as unknown as { renderer: { info: { render: { calls: number } } }; post: { render(dt: number): void } };
    const post = r.post;
    const original = post.render.bind(post);
    const w = window as unknown as { __frameCalls: number };
    post.render = (dt: number) => {
      original(dt);
      w.__frameCalls = r.renderer.info.render.calls;
    };
  });
  const calls = async (shell: boolean) => {
    await setShell(page, shell);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const r = window.__cinder!.renderer as unknown as { shadows: { tagNow(root: unknown): void }; scene: unknown };
      r.shadows.tagNow(r.scene);
    });
    await page.waitForTimeout(1200);
    return page.evaluate(() => (window as unknown as { __frameCalls: number }).__frameCalls);
  };
  const off = await calls(false);
  const on = await calls(true);
  console.log('[hull shell perf] shaped fighter draw calls shell off / on:', off, on);
  // +1 at most: the nav light layer
  expect(on - off).toBeGreaterThanOrEqual(0);
  expect(on - off).toBeLessThanOrEqual(1);
  await setPaused(page, false);
  await waitTicks(page, 30);
  expect(await programs(page)).toBe(before);
  expect(errors).toEqual([]);
});

/** Screen clip (CSS px) of `size` around a sim point. */
async function clipAt(page: Page, at: { x: number; y: number }, w: number, h: number) {
  const c = await page.evaluate((q) => window.__cinder!.renderer.worldToScreen(q), at);
  return { x: Math.max(0, c.x - w / 2), y: Math.max(0, c.y - h / 2), width: w, height: h };
}

test.describe('hull shell screenshots', () => {
  test.use({ deviceScaleFactor: 2 });

  test('a pirate losing parts shows torn edges', async ({ page }) => {
    test.skip(!SHOTS, 'screenshots only (HULL_SHOT_DIR)');
    test.setTimeout(150_000);
    await loadFixture(page, 'pirates-near', { ticks: 10 });
    await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('high'));
    const [id] = await arena(page, ['hammer'], 8, true);
    await setZoom(page, 16);
    await waitTicks(page, 30);
    await hideUi(page, true);
    await setPaused(page, true);
    await frames(page, 8);
    const pos = await page.evaluate((id) => window.__cinder!.sim.state.combat.enemies.find((e) => e.id === id)!.body.pos, id!);
    await page.screenshot({ path: `${SHOTS}/pirate-whole.png`, clip: await clipAt(page, pos, 420, 340) });
    await setPaused(page, false);
    await shootOff(page, [id!], 3);
    await waitTicks(page, 4);
    await setPaused(page, true);
    await frames(page, 8);
    const s = await combatStats(page);
    expect(s.ships.find((x) => x.id === id)!.shell.tornEdges).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/pirate-torn.png`, clip: await clipAt(page, pos, 420, 340) });
    await page.screenshot({ path: `${SHOTS}/pirate-torn-full.png` });
  });
});
