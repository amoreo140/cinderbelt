import { expect, test } from './test';
import type { Page } from '@playwright/test';

// M3.5b "Discoveries": scan pulse, a place with a label (Callout), analysis, journal (Knowledge, Atlas),
// Archive in the hub, giant asteroid when breaking the shell, Echo beacon and the map with layers.
// Screenshots: test-results-m35b/m35b-*.png

const OUT = 'test-results-m35b';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const);
}

async function play(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
  // controls help collapsed – it does not cover the scene at the top right
  await page.evaluate(() => {
    (window.__cinder!.game as unknown as { helpOpen: boolean; helpTouched: boolean }).helpOpen = false;
    (window.__cinder!.game as unknown as { helpTouched: boolean }).helpTouched = true;
  });
}

/** Departure and moving the ship (in flight, stopped) to a place – the world loads around it. */
async function flyTo(page: Page, pos: { x: number; y: number }, angle = 0): Promise<void> {
  if (await page.getByTestId('station-hub').isVisible()) {
    await page.keyboard.press('KeyF');
    await expect(page.getByTestId('station-hub')).toBeHidden();
  }
  await page.evaluate(
    ([x, y, a]) => {
      const { sim } = window.__cinder!;
      const body = { pos: { x, y }, vel: { x: 0, y: 0 }, angle: a, angVel: 0 };
      sim.state.player.body = body;
      sim.state.player.prevBody = body;
      sim.state.player.dampers = true;
      sim.state.world.update(body.pos);
    },
    [pos.x, pos.y, angle] as const,
  );
  await waitTicks(page, 40);
  // the camera catches up with the ship (smooth follow)
  await page.waitForTimeout(700);
}

/** The first POI of the given kind near home (game seed). */
async function findPoi(page: Page, kind: string, type?: string): Promise<{ id: string; pos: { x: number; y: number }; resource?: string }> {
  return page.evaluate(
    async ([path, k, t]) => {
      const m = (await import(path!)) as typeof import('../../src/sim/discovery/testing');
      const { sim } = window.__cinder!;
      const p = m.findPoi(sim.state.seed, k as 'anomaly', (x) => !t || (x as { type?: string }).type === t);
      return { id: p.id, pos: p.pos, resource: (p as { resource?: string }).resource };
    },
    ['/src/sim/discovery/testing.ts', kind, type ?? ''] as const,
  );
}

/** Mouse over a point of the world. */
async function aimAt(page: Page, pos: { x: number; y: number }): Promise<void> {
  const p = await page.evaluate(([x, y]) => window.__cinder!.renderer.worldToScreen({ x, y }), [pos.x, pos.y] as const);
  await page.mouse.move(p.x, p.y);
}

test('M3.5b: scanner pulse, a place with a callout, analysis and the journal', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await play(page);
  const anomaly = await findPoi(page, 'anomaly', 'ion');
  // pulse from afar: a signal with a circle of uncertainty
  await flyTo(page, { x: anomaly.pos.x + 380, y: anomaly.pos.y + 40 });
  await expect(page.getByTestId('scan-widget')).toBeVisible();
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__cinder!.sim.state.discovery.signals.length > 0);
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${OUT}/m35b-scan-pulse.png` });
  expect(await page.evaluate(() => window.__cinder!.sim.state.discovery.scanner.cooldown)).toBeGreaterThan(0);
  await waitTicks(page, 60);
  await page.screenshot({ path: `${OUT}/m35b-scan-signals.png` });

  // fly-in: the place with a Callout label
  await flyTo(page, { x: anomaly.pos.x + 21, y: anomaly.pos.y - 7 });
  await expect(page.getByTestId(`callout-${anomaly.id}`)).toBeVisible();
  await page.screenshot({ path: `${OUT}/m35b-callout.png` });

  // analysis: hold Tab with the cursor on the anomaly
  await aimAt(page, anomaly.pos);
  const data0 = await page.evaluate(() => window.__cinder!.sim.state.discovery.dataTotal);
  await page.keyboard.down('Tab');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/m35b-analysis.png` });
  await page.waitForFunction(() => window.__cinder!.sim.state.discovery.scanned.size > 0, undefined, { timeout: 60_000 });
  await page.keyboard.up('Tab');
  const data1 = await page.evaluate(() => window.__cinder!.sim.state.discovery.dataTotal);
  expect(data1).toBeGreaterThan(data0);

  // journal: Knowledge and Atlas
  await page.keyboard.press('KeyJ');
  await expect(page.getByTestId('journal')).toBeVisible();
  await expect(page.getByTestId('knowledge-graph')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/m35b-journal.png` });
  await page.getByTestId('journal-tab-atlas').click();
  await expect(page.getByTestId('journal-atlas')).toBeVisible();
  await page.screenshot({ path: `${OUT}/m35b-journal-atlas.png` });
  await page.keyboard.press('KeyJ');
  await expect(page.getByTestId('journal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('M3.5b: Echo-0 beacon, the journal graph after the first act and the map with layers', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await play(page);
  // accepted a Delivery to a station contract, to a station the player does not know yet (target on the map)
  await page.evaluate(async (path) => {
    const st = (await import(path)) as typeof import('../../src/sim/world/stations');
    const { sim } = window.__cinder!;
    const far = st.stationsInArea(sim.state.seed, -12, 12, -12, 12).find((s) => s.id !== 'home' && !sim.state.world.discovered.has(s.id))!;
    sim.state.career.contracts.push({
      id: 'home@0.99', type: 'delivery', faction: 'guild', station: 'home', ring: far.ring, risk: 0,
      target: { kind: 'delivery', resource: 'copper', amount: 20, to: far.id }, modifiers: [], bonus: 0, part: null,
      serial: 99, acceptedTick: 0, seconds: 300, reward: 900, rep: 20, progress: 0, base: 0, ready: false,
    });
  }, '/src/sim/world/stations.ts');
  const echo = await page.evaluate(async (path) => {
    const m = (await import(path)) as typeof import('../../src/sim/discovery/poi');
    return m.echoSites(window.__cinder!.sim.state.seed)[0]!;
  }, '/src/sim/discovery/poi.ts');
  // triangulation from three places
  for (const [dx, dy] of [[0, 0], [220, 0], [0, 220]]) {
    await flyTo(page, { x: echo.pos.x * 0.45 + dx, y: echo.pos.y * 0.45 + dy });
    await page.evaluate(() => {
      const s = window.__cinder!.sim.state;
      s.discovery.scanner.cooldown = 0;
      s.player.energy = s.player.props.batteryCapacity;
    });
    await page.keyboard.press('Tab');
    await waitTicks(page, 10);
  }
  await page.waitForFunction(() => window.__cinder!.sim.state.discovery.known.has('echo:0'));
  await flyTo(page, { x: echo.pos.x - 15, y: echo.pos.y - 9 });
  await expect(page.getByTestId('callout-echo:0')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/m35b-ozvena.png` });
  await aimAt(page, echo.pos);
  await page.keyboard.down('Tab');
  // the analysis takes a few seconds of game time – longer on a loaded machine
  await page.waitForFunction(() => window.__cinder!.sim.state.discovery.scanned.has('echo:0'), undefined, { timeout: 60_000 });
  await page.keyboard.up('Tab');

  // map: signals, places, contract target at an undiscovered station, fields, rings, scale
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/m35b-map.png` });
  await page.getByTestId('map-layer-fields').click();
  await expect(page.getByTestId('map-layer-fields')).toHaveAttribute('aria-pressed', 'false');
  // mouse-wheel zoom and return to the ship
  const canvas = page.getByTestId('map-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/m35b-map-zoom.png` });
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyM');

  await page.keyboard.press('KeyJ');
  await expect(page.getByTestId('graph-echo0')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/m35b-journal-echo.png` });
  await page.keyboard.press('KeyJ');
  expect(errors).toEqual([]);
});

test('M3.5b: Archive tab in the hub and unlocking a node', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await play(page);
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.discovery.dataTotal = 420;
    s.discovery.dataFund = 260;
    s.discovery.archive.add('largeCargo');
    s.discovery.fragments.set('overdrive', 2);
    s.discovery.plans.add('survey');
    s.credits = 4200;
  });
  await page.keyboard.press('Digit5');
  await expect(page.getByTestId('archive')).toBeVisible();
  await page.getByTestId('archive-node-battery').click();
  await page.locator('.hub-body').evaluate((el) => el.scrollTo(0, 0));
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35b-archive.png` });
  await page.getByTestId('archive-unlock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.discovery.archive.has('battery'));
  await page.getByTestId('archive-node-heavyLaser').click();
  await page.locator('.hub-body').evaluate((el) => el.scrollTo(0, 400));
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35b-archive-unlocked.png` });
  // crafting: the battery is unlocked, the variant from the plan is in the list
  await page.keyboard.press('Digit2');
  await page.getByTestId('market-view-craft').click();
  await expect(page.getByTestId('recipe-battery:1')).toBeVisible();
  await expect(page.getByTestId('recipe-radar:1:survey')).toBeVisible();
  expect(errors).toEqual([]);
});

test('M3.5b: giant asteroid – the heavy laser breaks the shell', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await play(page);
  const giant = await findPoi(page, 'giant');
  await page.evaluate(async (paths) => {
    const g = (await import(paths[0]!)) as typeof import('../../src/sim/ship/grid');
    const pr = (await import(paths[1]!)) as typeof import('../../src/sim/ship/properties');
    const { sim } = window.__cinder!;
    const grid = g.createGrid([
      ['cockpit', 0, 0],
      ['heavyLaser', 1, 0],
      ['reactor', -1, 0],
      ['reactor', 0, 1],
      ['cargo', 0, -1],
      ['engine', -1, 1],
      ['engine', -1, -1],
    ]);
    const p = sim.state.player;
    p.grid = grid;
    p.props = pr.computeProperties(grid);
    p.gridVersion++;
    p.energy = p.props.batteryCapacity;
  }, ['/src/sim/ship/grid.ts', '/src/sim/ship/properties.ts']);
  await flyTo(page, { x: giant.pos.x - 24, y: giant.pos.y });
  await page.evaluate((id) => window.__cinder!.sim.state.discovery.giants.set(id, 70), giant.id);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/m35b-giant.png` });
  // cursor on the edge of the shell (the giant's centre is out of frame)
  await aimAt(page, { x: giant.pos.x - 10, y: giant.pos.y });
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction((id) => window.__cinder!.sim.state.discovery.giants.get(id) === 0, giant.id, { timeout: 20_000 });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/m35b-giant-break.png` });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/m35b-giant-core.png` });
  await page.mouse.up({ button: 'right' });
  expect(errors).toEqual([]);
});
