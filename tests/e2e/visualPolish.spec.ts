import { expect, test } from './test';
import type { Page } from '@playwright/test';

// Visual polish: the zone look (sun, planet below the plane), station traffic and the graphics
// quality setting (Settings → Display → Kvalita grafiky) switching shadows / AO on and off.
// Screenshots go to the Playwright output folder (--output).

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/${name}.png` });

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Rendered frames (software WebGL is slow – a value right after a change can be stale). */
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

const stats = (page: Page) => page.evaluate(() => window.__cinder!.renderer.visualStats());

test('visual polish: planet, traffic and the graphics quality setting', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });

  // software WebGL in the tests: auto = the minimal Low (no planets, no traffic)
  expect(await stats(page)).toMatchObject({ quality: 'low', shadows: false, ao: false, planets: 0 });

  // the setting: High turns on shadows and AO, Low turns them off, Auto returns to the GPU guess
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-settings').click();
  const row = page.getByTestId('set-graphics');
  await row.getByText('Vysoká').click();
  await waitFrames(page, 3);
  expect(await stats(page)).toMatchObject({ quality: 'high', shadows: true });
  await page.getByTestId('sheet-back').click();
  await page.getByTestId('pause-resume').click();
  await waitFrames(page, 4);
  expect((await stats(page)).ao).toBe(true);
  // the home belt's gas giant comes in once its textures are known, the home station has traffic
  await page.waitForFunction(() => window.__cinder!.renderer.visualStats().planets > 0, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => window.__cinder!.renderer.visualStats().traffic.vehicles > 0, undefined, { timeout: 30_000 });
  expect((await stats(page)).traffic.stations).toBeGreaterThan(0);
  await shot(page, 'polish-high');

  await page.keyboard.press('Escape');
  await page.getByTestId('pause-settings').click();
  await row.getByText('Nízka').click();
  await waitFrames(page, 3);
  expect(await stats(page)).toMatchObject({ quality: 'low', shadows: false, ao: false, planets: 0 });
  await row.getByText('Auto').click();
  await waitFrames(page, 3);
  // software WebGL in the tests: auto starts low (and the row says so)
  await expect(page.getByTestId('set-graphics-level')).not.toBeEmpty();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cinderbelt.settings') ?? '{}').graphicsQuality);
  expect(stored).toBe('auto');
  // background brightness (readability): a dimmed default, the slider reaches the renderer and is stored
  const background = page.getByTestId('set-background');
  expect(Number(await background.inputValue())).toBeCloseTo(0.6, 5);
  expect((await stats(page)).backgroundBrightness).toBeCloseTo(0.6, 5);
  await background.fill('0.3');
  await waitFrames(page, 2);
  expect((await stats(page)).backgroundBrightness).toBeCloseTo(0.3, 5);
  const storedBackground = await page.evaluate(() => JSON.parse(localStorage.getItem('cinderbelt.settings') ?? '{}').backgroundBrightness);
  expect(storedBackground).toBeCloseTo(0.3, 5);
  // dynamic resolution (optimisation R3): on by default, stored when switched; never active on a
  // software rasterizer (no GPU timer worth following), so the scene renders at full resolution here
  const drs = page.getByTestId('set-dynamic-resolution');
  await expect(drs.getByRole('button', { name: 'Zapnuté', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await drs.getByRole('button', { name: 'Vypnuté', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cinderbelt.settings') ?? '{}').dynamicResolution)).toBe(false);
  await drs.getByRole('button', { name: 'Zapnuté', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cinderbelt.settings') ?? '{}').dynamicResolution)).toBe(true);
  expect(await page.evaluate(() => window.__cinder!.renderer.dynamicResolutionStats())).toMatchObject({ active: false, scale: 1 });
  await page.getByTestId('sheet-back').click();
  await page.getByTestId('pause-resume').click();
  await shot(page, 'polish-auto');

  // a zone border: the outer belts (their look cross-fades in)
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const body = { pos: { x: 1900, y: 40 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    sim.state.world.update(body.pos);
  });
  await page.waitForTimeout(3000);
  await waitFrames(page, 3);
  await shot(page, 'polish-ring2');
  expect(errors).toEqual([]);
});

test('far landmarks: in the view at High, the Echo column once the beacon is located', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('high'));
  // fly in sight of the ring-1 relay mast (it hangs 1 100 u below the plane, seen ~770 u ahead)
  // dev-server module paths (a variable keeps tsc from resolving them as files)
  const MODULES = { landmarks: '/src/sim/world/landmarks.ts', poi: '/src/sim/discovery/poi.ts' };
  const relay = await page.evaluate(async (M) => {
    const { landmarkSites } = await import(/* @vite-ignore */ M.landmarks);
    const { sim } = window.__cinder!;
    const site = (landmarkSites(sim.state.seed) as { kind: string; pos: { x: number; y: number } }[]).find((s) => s.kind === 'guild_relay')!;
    sim.state.player.dock = { mode: 'flying' } as typeof sim.state.player.dock;
    const body = { pos: { x: site.pos.x, y: site.pos.y - 770 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    return site.pos;
  }, MODULES);
  expect(Math.hypot(relay.x, relay.y)).toBeGreaterThan(899);
  await page.waitForFunction(() => window.__cinder!.renderer.visualStats().landmarks.visible > 0, undefined, { timeout: 60_000 });
  // the Echo column stays dark until the beacon is located, then lights up
  expect((await stats(page)).landmarks.echoColumns).toBe(0);
  await page.evaluate(async (M) => {
    const { echoSites } = await import(/* @vite-ignore */ M.poi);
    const { sim } = window.__cinder!;
    const echo = (echoSites(sim.state.seed) as { id: string; pos: { x: number; y: number } }[])[0]!;
    sim.state.discovery.known.add(echo.id);
    const body = { pos: { x: echo.pos.x + 300, y: echo.pos.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
  }, MODULES);
  await page.waitForFunction(() => window.__cinder!.renderer.visualStats().landmarks.echoColumns > 0, undefined, { timeout: 30_000 });
  await waitFrames(page, 3);
  await shot(page, 'polish-landmarks');
  expect(errors).toEqual([]);
});

test('scenery scatter (art batch B): clutter by quality, damage decals on the hull', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  // software WebGL: auto = the minimal Low – no scenery at all
  await waitFrames(page, 3);
  expect((await stats(page)).scatter.pieces).toBe(0);
  // High: the home station's approach lights (always shown) and the rest of the chunk's clutter
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('high'));
  await page.waitForFunction(() => window.__cinder!.renderer.visualStats().scatter.pieces > 0, undefined, { timeout: 60_000 });
  const high = (await stats(page)).scatter;
  expect(high.byModel.nav_beacon).toBeGreaterThanOrEqual(2);
  // Medium: a thinner subset (the approach lights stay); Low on software WebGL: none again
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('medium'));
  await waitFrames(page, 3);
  const medium = (await stats(page)).scatter;
  expect(medium.byModel.nav_beacon).toBeGreaterThanOrEqual(2);
  expect(medium.pieces).toBeLessThanOrEqual(high.pieces);
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('low'));
  await waitFrames(page, 3);
  expect((await stats(page)).scatter.pieces).toBe(0);
  // a hurt hull shows damage decals (one instanced draw per ship)
  const decals = await page.evaluate(async () => {
    const { sim, renderer } = window.__cinder!;
    for (const p of sim.state.player.grid.parts) sim.state.player.hp.set(p.id, 1);
    await new Promise((r) => setTimeout(r, 500));
    return (renderer as unknown as { shipView: { decalCount: number } }).shipView.decalCount;
  });
  expect(decals).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('sector zones: sky, light and dust follow the sector depth past the border, not the ring circle', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  // the depth 1 → 2 border farthest from the old 1 500 u ring circle (dev-server module path)
  const MODULES = { sectors: '/src/sim/regions/sectors.ts' };
  const border = await page.evaluate(async (M) => {
    const { sectorInfoAt } = await import(/* @vite-ignore */ M.sectors);
    const seed = window.__cinder!.sim.state.seed;
    let best = { r: 1500, dx: 1, dy: 0 };
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let r = 0;
      while ((sectorInfoAt(seed, dx * r, dy * r) as { depth: number }).depth === 1) r += 2;
      if (Math.abs(r - 1500) > Math.abs(best.r - 1500)) best = { r, dx, dy };
    }
    return best;
  }, MODULES);
  expect(Math.abs(border.r - 1500)).toBeGreaterThan(100);
  const put = (d: number) =>
    page.evaluate(
      ({ b, d }) => {
        const { sim } = window.__cinder!;
        sim.state.player.dock = { mode: 'flying' } as typeof sim.state.player.dock;
        const pos = { x: b.dx * (b.r + d), y: b.dy * (b.r + d) };
        const body = { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
        sim.state.player.body = body;
        sim.state.player.prevBody = body;
      },
      { b: border, d },
    );
  const zone = async () => (await stats(page)).zone;
  await put(-100);
  await waitFrames(page, 3);
  const inside = await zone();
  expect(inside.look).toMatch(/^1:/);
  expect(inside.sky).toBe(1);
  // a few units past the border: the hysteresis keeps the zone
  await put(12);
  await waitFrames(page, 3);
  expect((await zone()).sector).toBe(inside.sector);
  // well past it: the depth-2 look cross-fades in
  await put(100);
  await waitFrames(page, 3);
  const outside = await zone();
  expect(outside.look).toMatch(/^2:/);
  expect(outside.shown).toBe(outside.look);
  expect(outside.fading).toBe(true);
  expect(errors).toEqual([]);
});

test('sector borders (sectors stage 2): markers, fences, lane buoys and the Guild Watch by quality, within the draw-call budget', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  // a marker on a border between two securities and a lane buoy, from the same planner (dev-server module path)
  const MODULES = { plan: '/src/render/borders/borderPlan.ts', sectors: '/src/sim/regions/sectors.ts' };
  const spots = await page.evaluate(async (M) => {
    const { BorderPlanner } = await import(/* @vite-ignore */ M.plan);
    const { sectorInfo } = await import(/* @vite-ignore */ M.sectors);
    const seed = window.__cinder!.sim.state.seed;
    const planner = new BorderPlanner(seed);
    let marker: { x: number; y: number } | null = null;
    let buoy: { x: number; y: number } | null = null;
    for (let r = 0; r <= 20 && (!marker || !buoy); r++) {
      for (let cx = -r; cx <= r; cx++) {
        for (let cy = -r; cy <= r; cy++) {
          if (Math.max(Math.abs(cx), Math.abs(cy)) !== r) continue;
          const m = planner.chunk(cx, cy).markers.find((q: { sector: string; other: string }) => sectorInfo(seed, q.sector).security !== sectorInfo(seed, q.other).security);
          if (!marker && m) marker = { x: m.pos.x, y: m.pos.y };
          const b = planner.buoys(cx, cy)[0];
          if (!buoy && b) buoy = { x: b.pos.x, y: b.pos.y };
        }
      }
    }
    return { marker, buoy };
  }, MODULES);
  expect(spots.marker).not.toBeNull();
  expect(spots.buoy).not.toBeNull();
  const put = (p: { x: number; y: number }, dx = 0) =>
    page.evaluate(
      ({ p, dx }) => {
        const { sim } = window.__cinder!;
        sim.state.player.dock = { mode: 'flying' } as typeof sim.state.player.dock;
        const body = { pos: { x: p.x + dx, y: p.y + 12 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
        sim.state.player.body = body;
        sim.state.player.prevBody = body;
        sim.state.world.update(body.pos);
      },
      { p, dx },
    );
  const borders = async () => (await stats(page)).borders;
  /** Median draw calls over a few frames with the layer shown or hidden. */
  const calls = (shown: boolean) =>
    page.evaluate(async (on) => {
      const r = window.__cinder!.renderer as unknown as { borders: { object: { visible: boolean } }; renderer: { info: { render: { calls: number } } } };
      r.borders.object.visible = on;
      const list: number[] = [];
      await new Promise<void>((resolve) => {
        let n = 0;
        const f = () => {
          if (n++ > 2) list.push(r.renderer.info.render.calls);
          if (n < 12) requestAnimationFrame(f);
          else resolve();
        };
        requestAnimationFrame(f);
      });
      r.borders.object.visible = true;
      return list.sort((a, b) => a - b)[list.length >> 1]!;
    }, shown);

  // High: markers on both sides, the fences and ribbons, halos at the lamps
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('high'));
  await put(spots.marker!);
  await page.waitForFunction(() => {
    const b = window.__cinder!.renderer.visualStats().borders;
    return b.loaded && b.markers > 0 && b.fences && b.halos > 0;
  }, undefined, { timeout: 60_000 });
  const high = await borders();
  expect(high.fenceVertices).toBeGreaterThan(0);
  await shot(page, 'borders-high');
  expect((await calls(true)) - (await calls(false))).toBeLessThanOrEqual(10);
  // a Guild Lane: buoys with their halos
  await put(spots.buoy!, 15);
  await page.waitForFunction(() => window.__cinder!.renderer.visualStats().borders.buoys > 0, undefined, { timeout: 60_000 });
  await shot(page, 'borders-lane');
  // Low on software WebGL (the minimal preset): markers and buoys only – no fences, halos or patrols
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('low'));
  await put(spots.marker!);
  await waitFrames(page, 4);
  const low = await borders();
  expect(low.markers).toBeGreaterThan(0);
  expect(low.fences).toBe(false);
  expect(low.halos).toBe(0);
  expect(low.ships).toBe(0);
  expect(errors).toEqual([]);
});
