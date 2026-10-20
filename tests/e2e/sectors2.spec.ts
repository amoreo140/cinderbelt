import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { dockAtClamp } from './dockHelper';
import { loadFixture } from './fixtures';

// Sectors stage 2 – the UI:
// Cartography on the station Board (buy a Guild chart), charting a sector by its survey points (the
// flight callout, the radar, the map, the toasts), selling its chart, the sector card, the "First chart"
// slip and the Guild Training's map callouts. Screenshots go to the output dir (`--output=<dir>`).

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

const out = (name: string) => `${test.info().project.outputDir}/${name}.png`;
const MODULES = { charts: '/src/sim/charts/charts.ts', survey: '/src/sim/regions/survey.ts', regions: '/src/sim/regions/index.ts' } as const;

async function placeShip(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([px, py]) => {
      const { sim } = window.__cinder!;
      const body = { pos: { x: px, y: py }, vel: { x: 0, y: 0 }, angle: Math.PI / 2, angVel: 0 };
      sim.state.player.body = body;
      sim.state.player.prevBody = body;
      sim.state.player.dampers = true;
      sim.state.world.update(body.pos);
    },
    [x, y] as const,
  );
}

async function undock(page: Page): Promise<void> {
  if (await page.getByTestId('station-hub').isVisible()) {
    await page.keyboard.press('KeyF');
    await expect(page.getByTestId('station-hub')).toBeHidden();
  }
}

async function openCartography(page: Page, label: RegExp): Promise<void> {
  await page.getByTestId('tab-board').click();
  await page.getByRole('button', { name: label }).click();
  await expect(page.getByTestId('cartography')).toBeVisible();
}

/**
 * The nearest depth-1 or depth-2 sector whose chart the Guild buys (not a pirate corner) that visiting its survey
 * points alone does not chart by flight coverage (the 3 × 3 chunks explored around each point stay
 * under 70 % of the sector) – so the last point is what charts it.
 */
async function sectorToChart(page: Page): Promise<{ id: string; points: { x: number; y: number }[] }> {
  return page.evaluate(async (m) => {
    const charts = (await import(/* @vite-ignore */ m.charts)) as typeof import('../../src/sim/charts/charts');
    const survey = (await import(/* @vite-ignore */ m.survey)) as typeof import('../../src/sim/regions/survey');
    const regions = (await import(/* @vite-ignore */ m.regions)) as typeof import('../../src/sim/regions/index');
    const s = window.__cinder!.sim.state;
    const CHUNK = 200;
    const fits = (id: string): boolean => {
      const keys = new Set(regions.sectorChunkKeys(s.seed, id));
      const seen = new Set<string>();
      for (const p of survey.surveyPoints(s.seed, id)) {
        const cx = Math.floor(p.pos.x / CHUNK);
        const cy = Math.floor(p.pos.y / CHUNK);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (keys.has(`${cx + dx},${cy + dy}`)) seen.add(`${cx + dx},${cy + dy}`);
      }
      for (const k of s.world.explored) if (keys.has(k)) seen.add(k);
      return seen.size < keys.size * 0.7 - 1;
    };
    const list = regions
      .regionWorld(s.seed)
      .regions.filter((r) => {
        const id = r.seed.id;
        const info = regions.sectorInfo(s.seed, id)!;
        return r.seed.depth <= 2 && info.corner === null && charts.chartTrade(s.seed, id) === 'player' && regions.sectorKnowledge(s, id) !== 'charted' && survey.surveyPoints(s.seed, id).length > 0 && fits(id);
      })
      .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y));
    const r = list[0]!;
    return { id: r.seed.id, points: survey.surveyPoints(s.seed, r.seed.id).map((p) => ({ ...p.pos })) };
  }, MODULES);
}

/** A ready scanner (no cooldown, full battery) – the pulse is Tab. */
async function pulse(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.discovery.scanner.cooldown = 0;
    s.player.energy = s.player.props.batteryCapacity;
  });
  await page.keyboard.press('Tab');
}

test('sectors 2: buy a Guild chart on the Board (SK) – Cartography, confirmation, toast', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'start');
  await page.evaluate(() => {
    window.__cinder!.sim.state.credits = 5000;
  });
  await openCartography(page, /Kartografia/);
  await expect(page.getByTestId('cartography-empty-sell')).toBeVisible();
  await expect(page.getByTestId('cartography-never')).toContainText('úkryty, Ozveny ani obsah vrakov');
  await page.getByTestId('station-hub').screenshot({ path: out('sk-board-cartography') });
  const buy = page.locator('[data-testid^="chart-buy-"]').first();
  const id = ((await buy.getAttribute('data-testid')) ?? '').replace('chart-buy-', '');
  await buy.click();
  await expect(page.getByTestId('chart-confirm-body')).toContainText('Nedá Dáta');
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('sk-board-cartography-confirm') });
  const credits = await page.evaluate(() => window.__cinder!.sim.state.credits);
  await page.getByRole('button', { name: /Kúpiť ·/ }).click();
  await expect(page.getByTestId('toast')).toContainText('Mapa kúpená', { timeout: 5000 });
  await expect(page.getByTestId(`chart-${id}`)).toHaveCount(0);
  const after = await page.evaluate((sector) => ({ credits: window.__cinder!.sim.state.credits, bought: window.__cinder!.sim.state.regions.bought.has(sector) }), id);
  expect(after.bought).toBe(true);
  expect(after.credits).toBeLessThan(credits);
  expect(errors).toEqual([]);
});

test('sectors 2: chart a sector by its survey points and sell its chart (SK) – callout, radar, map, card, toasts', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'start');
  // the "First chart" slip on the home Board
  await page.getByTestId('tab-board').click();
  const first = page.locator('.af-slip, .bd-row', { hasText: 'Prvá mapa' }).first();
  await expect(first).toBeVisible();
  await first.screenshot({ path: out('sk-slip-first-chart') });

  const target = await sectorToChart(page);
  await undock(page);
  const p0 = target.points[0]!;
  // to the first point (a jump – flying there would chart the sector by coverage on the way): within
  // the pulse's reach the callout says "Measuring point · Tab"
  await placeShip(page, p0.x + 28, p0.y - 18);
  // the zone around the jump streams in (rocks, the camera settles)
  await page.waitForTimeout(2500);
  const callout = page.getByTestId(`callout-survey:${target.id}:0`);
  await expect(callout).toBeVisible();
  await expect(callout).toContainText('Merací bod');
  await expect(callout).toContainText('Tab');
  await page.screenshot({ path: out('sk-flight-survey-callout') });
  await page.locator('.hud-radar').screenshot({ path: out('sk-radar-survey') });
  await pulse(page);
  await expect.poll(() => page.evaluate((id) => window.__cinder!.sim.state.regions.points.get(id) ?? 0, target.id)).toBe(1);
  await expect(page.getByTestId('toast')).toContainText(`Merací bod 1/${target.points.length}`, { timeout: 5000 });
  await expect(page.getByTestId('sector-badge-survey')).toBeVisible();

  // the map: the sector's points (one marked), its card with the survey progress and the chart price
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  const box = (await page.getByTestId('map-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const card = page.getByTestId('sector-card');
  if (!((await card.textContent()) ?? '').includes('Meracie body')) {
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2);
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId('sector-card-survey')).toContainText(`Meracie body 1/${target.points.length}`);
  await expect(page.getByTestId('sector-card-chart')).toContainText('Cech kúpi');
  await page.getByTestId('map').screenshot({ path: out('sk-map-survey-points') });
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeHidden();

  // the remaining points: the last one charts the sector
  for (let i = 1; i < target.points.length; i++) {
    const p = target.points[i]!;
    await placeShip(page, p.x + 22, p.y);
    await page.waitForTimeout(i === 1 ? 2500 : 250);
    // the world marker (a reticle on the plane) at a point that is not a POI
    if (i === 1) await page.screenshot({ path: out('sk-flight-survey-marker') });
    await pulse(page);
    const last = i === target.points.length - 1;
    await expect(page.getByTestId('toast')).toContainText(last ? 'mapu môžeš predať Cechu' : `Merací bod ${i + 1}/${target.points.length}`, { timeout: 5000 });
  }
  await page.screenshot({ path: out('sk-flight-charted-toast') });
  expect(await page.evaluate((id) => window.__cinder!.sim.state.regions.points.get(id), target.id)).toBe((1 << target.points.length) - 1);

  // home and sell the chart on the Board
  await placeShip(page, 0, 60);
  await page.waitForTimeout(300);
  await dockAtClamp(page, { stationId: 'home' });
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await openCartography(page, /Kartografia/);
  const row = page.getByTestId(`chart-${target.id}`);
  await expect(row).toHaveAttribute('data-state', 'sellable');
  await page.getByTestId('station-hub').screenshot({ path: out('sk-board-cartography-sell') });
  const credits = await page.evaluate(() => window.__cinder!.sim.state.credits);
  await page.getByTestId(`chart-sell-${target.id}`).click();
  await page.getByRole('button', { name: /Predať ·/ }).click();
  await expect(page.getByTestId('toast')).toContainText('Mapa predaná', { timeout: 5000 });
  await expect(row).toHaveAttribute('data-state', 'sold');
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBeGreaterThan(credits);
  await page.getByTestId('station-hub').screenshot({ path: out('sk-board-cartography-sold') });
  expect(errors).toEqual([]);
});

test('sectors 2: English Cartography, survey callout, map points and sector card', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await loadFixture(page, 'start');
  await openCartography(page, /Cartography/);
  await expect(page.getByTestId('cartography-never')).toContainText('never shows caches, Echoes or wreck contents');
  await page.getByTestId('station-hub').screenshot({ path: out('en-board-cartography') });
  await page.getByRole('button', { name: /^Contracts$/ }).click();
  const first = page.locator('.af-slip, .bd-row', { hasText: 'First chart' }).first();
  await expect(first).toBeVisible();
  await first.screenshot({ path: out('en-slip-first-chart') });

  const target = await sectorToChart(page);
  await undock(page);
  const p0 = target.points[0]!;
  await placeShip(page, p0.x + 28, p0.y - 18);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId(`callout-survey:${target.id}:0`)).toContainText('Survey point');
  await page.screenshot({ path: out('en-flight-survey-callout') });
  await pulse(page);
  await expect(page.getByTestId('toast')).toContainText(`Survey point 1/${target.points.length}`, { timeout: 5000 });
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  const box = (await page.getByTestId('map-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2);
  await expect(page.getByTestId('sector-card-survey')).toContainText(`Survey points 1/${target.points.length}`);
  await page.getByTestId('map').screenshot({ path: out('en-map-survey-points') });
  expect(errors).toEqual([]);
  await context.close();
});

test('sectors 2: Guild Training step 8 – the map explains Origin, the lane, a Reported sector and the red corner', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'training-mid');
  // jump to the checklist step (8 of 9)
  await page.evaluate(() => {
    window.__cinder!.sim.state.career.training.step = 7;
    window.__cinder!.sim.state.career.training.flags = 0;
  });
  await undock(page);
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  const notes = page.getByTestId('map-notes');
  await expect(notes).toBeVisible();
  await expect(page.getByTestId('callout-map-training-origin')).toContainText('[x]');
  await expect(page.getByTestId('callout-map-training-corner')).toContainText('Tam bez kanóna nelietaj.');
  await page.getByTestId('map').screenshot({ path: out('sk-training-step8-map') });
  // the step ticks the map off; its reward also charts lane A's first sector
  await expect.poll(() => page.evaluate(() => window.__cinder!.sim.state.career.training.flags & 2)).toBe(2);
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('training-panel')).toContainText(/mapa sektora/);
  expect(errors).toEqual([]);
});
