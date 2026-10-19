import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// Sectors stage 1b – presentation: the
// sector card on the map (each security, pinned), the radio on entering a Guarded and a Pirate sector,
// the radar rim in the sector's security colour, scenery clutter in a pirate sector. Screenshots go to
// the output dir (`--output=<dir>`).

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

const out = (name: string) => `${test.info().project.outputDir}/${name}.png`;

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

/** Short hops (the HUD sees each one – no "tow" jump), stopping once `until` holds. */
async function walkShip(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, until?: () => Promise<boolean>, hop = 80): Promise<void> {
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / hop));
  for (let k = 1; k <= n; k++) {
    await placeShip(page, from.x + ((to.x - from.x) * k) / n, from.y + ((to.y - from.y) * k) / n);
    await page.waitForTimeout(140);
    if (until && (await until())) return;
  }
}

async function undock(page: Page): Promise<void> {
  if (await page.getByTestId('station-hub').isVisible()) {
    await page.keyboard.press('KeyF');
    await expect(page.getByTestId('station-hub')).toBeHidden();
  }
}

const WORLD = '/src/sim/regions/world.ts';

/** Map canvas points (CSS px) where the card shows each security, from a grid scan of the hover. */
async function scanCards(page: Page): Promise<Map<string, { x: number; y: number }>> {
  const canvas = page.getByTestId('map-canvas');
  const box = (await canvas.boundingBox())!;
  const found = new Map<string, { x: number; y: number }>();
  const card = page.getByTestId('sector-card');
  for (let j = 1; j < 10; j++) {
    for (let i = 1; i < 14; i++) {
      const x = box.x + (box.width * i) / 14;
      const y = box.y + (box.height * j) / 10;
      await page.mouse.move(x, y);
      await page.waitForTimeout(25);
      if (!(await card.isVisible())) continue;
      const sec = (await card.getAttribute('data-security')) ?? '';
      if (!found.has(sec)) found.set(sec, { x, y });
    }
  }
  return found;
}

test('sectors 1b: the sector card on the map for each security, pinned by a click (SK, 1280×720)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'start');
  await undock(page);
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  const canvas = page.getByTestId('map-canvas');
  const box = (await canvas.boundingBox())!;
  // the home sector under the ship (the map opens centred on it)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const card = page.getByTestId('sector-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Počiatok');
  await expect(card).toContainText('Si tu');
  await expect(card).toContainText('Domovský sektor');
  await page.getByTestId('map').screenshot({ path: out('sk-card-home') });
  // zoom out to see the depths around home, then find each security by hovering
  for (let i = 0; i < 7; i++) await page.mouse.wheel(0, 200);
  await page.waitForTimeout(600);
  const found = await scanCards(page);
  console.log('[sector card scan]', JSON.stringify([...found.keys()]));
  expect(found.has('guarded')).toBe(true);
  expect(found.has('pirate')).toBe(true);
  for (const [sec, at] of found) {
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(200);
    await expect(card).toHaveAttribute('data-security', sec);
    await page.getByTestId('map').screenshot({ path: out(`sk-card-${sec}`) });
  }
  // a click pins the pirate sector's card; it stays while the cursor moves on, a second click releases it
  const pirate = found.get('pirate')!;
  await page.mouse.move(pirate.x, pirate.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(card).toContainText('Pripnuté');
  await expect(page.getByTestId('sector-card-route')).toContainText('Trasa domov');
  const other = found.get('guarded')!;
  await page.mouse.move(other.x, other.y);
  await page.waitForTimeout(150);
  await expect(card).toHaveAttribute('data-security', 'pirate');
  await page.getByTestId('map').screenshot({ path: out('sk-card-pinned') });
  await page.mouse.move(pirate.x, pirate.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(card).toContainText('Klik kartu pripne');
  expect(errors).toEqual([]);
});

test('sectors 1b: English card at 1920×1080', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await loadFixture(page, 'hour1');
  await undock(page);
  await placeShip(page, 260, 180);
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  const box = (await page.getByTestId('map-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 200);
  await page.waitForTimeout(500);
  const found = await scanCards(page);
  const pick = found.get('contested') ?? found.get('pirate') ?? found.get('guarded')!;
  await page.mouse.move(pick.x, pick.y);
  await page.waitForTimeout(200);
  await expect(page.getByTestId('sector-card-route')).toContainText('Route home');
  await page.getByTestId('map').screenshot({ path: out('en-card-1080') });
  expect(errors).toEqual([]);
  await context.close();
});

test('sectors 1b: radio on entering a Guarded and a Pirate sector, radar rim in the security colour (SK)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'start');
  await undock(page);
  await page.waitForTimeout(400);
  await page.locator('.hud-radar').screenshot({ path: out('sk-radar-rim-guarded') });

  // the nearest Guarded sector nobody has visited: the Guild Watch welcomes the pilot
  const guarded = await page.evaluate(async (path) => {
    const w = (await import(/* @vite-ignore */ path)) as typeof import('../../src/sim/regions/world');
    const s = window.__cinder!.sim.state;
    const world = w.regionWorld(s.seed);
    const visited = new Set<string>();
    for (const key of s.world.explored) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      visited.add(world.field.regionOfChunk(cx, cy).id);
    }
    const r = world.regions
      .filter((x) => x.security === 'guarded' && !x.seed.origin && !visited.has(x.seed.id))
      .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y))[0]!;
    return { id: r.seed.id, x: r.seed.x, y: r.seed.y };
  }, WORLD);
  const speaker = page.getByTestId('comm-speaker');
  const from = await page.evaluate(() => ({ ...window.__cinder!.sim.state.player.body.pos }));
  await walkShip(page, from, guarded, async () => ((await speaker.isVisible()) && ((await speaker.textContent()) ?? '').includes('Stráž Cechu')));
  // another call (a distress signal) may be on the air first – the welcome waits behind it
  await expect(speaker).toContainText('Stráž Cechu', { timeout: 20_000 });
  await expect(page.getByTestId('comm-text')).toContainText(/sektor/i, { timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out('sk-radio-guarded') });

  // the depth-1 pirate corner: jump next to its border (silently), then fly in – traffic control warns
  const corner = await page.evaluate(async (path) => {
    const w = (await import(/* @vite-ignore */ path)) as typeof import('../../src/sim/regions/world');
    const s = window.__cinder!.sim.state;
    const world = w.regionWorld(s.seed);
    const id = world.corners.depth1!;
    const c = world.field.seedById(id)!;
    // from home toward the corner's seed: the first point inside it, and a point 140 u before it
    const len = Math.hypot(c.x, c.y);
    for (let d = 0; d < len; d += 10) {
      const x = (c.x * d) / len;
      const y = (c.y * d) / len;
      if (world.field.regionAt(x, y).id === id) {
        const back = Math.max(0, d - 140);
        return { id, outside: { x: (c.x * back) / len, y: (c.y * back) / len }, inside: { x: (c.x * Math.min(len, d + 220)) / len, y: (c.y * Math.min(len, d + 220)) / len } };
      }
    }
    return { id, outside: { x: c.x * 0.5, y: c.y * 0.5 }, inside: { x: c.x, y: c.y } };
  }, WORLD);
  // let the welcome finish so the warning is on the air when it comes
  await page.waitForTimeout(6000);
  await placeShip(page, corner.outside.x, corner.outside.y);
  await page.waitForTimeout(600);
  await walkShip(
    page,
    corner.outside,
    corner.inside,
    async () => (await speaker.isVisible()) && ((await speaker.textContent()) ?? '').includes('riadenie'),
    40,
  );
  await expect(speaker).toContainText('riadenie', { timeout: 20_000 });
  await expect(page.getByTestId('comm-text')).toContainText('Šakalí kút', { timeout: 5000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out('sk-radio-pirate') });
  await expect(page.getByTestId('sector-badge')).toContainText('Pirátsky');
  await page.locator('.hud-radar').screenshot({ path: out('sk-radar-rim-pirate') });
  expect(errors).toEqual([]);
});

test('sectors 1b: scenery clutter in a pirate sector and a quiet sky next to the gas giant (High)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'start');
  await undock(page);
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('high'));
  const spots = await page.evaluate(async (path) => {
    const w = (await import(/* @vite-ignore */ path)) as typeof import('../../src/sim/regions/world');
    const s = window.__cinder!.sim.state;
    const world = w.regionWorld(s.seed);
    const pirate = world.regions
      .filter((r) => r.security === 'pirate' && r.seed.depth === 2 && r.fixed !== 'fortress')
      .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y))[0]!;
    // a depth-2 sector within sight of the gas giant (home + (−1150, 2270))
    const giant = { x: -1150, y: 2270 };
    const near = world.regions
      .filter((r) => r.seed.depth === 2)
      .sort((a, b) => Math.hypot(a.seed.x - giant.x, a.seed.y - giant.y) - Math.hypot(b.seed.x - giant.x, b.seed.y - giant.y))[0]!;
    return { pirate: { x: pirate.seed.x, y: pirate.seed.y, id: pirate.seed.id }, near: { x: near.seed.x, y: near.seed.y } };
  }, WORLD);
  await placeShip(page, spots.pirate.x, spots.pirate.y);
  await page.waitForFunction(() => window.__cinder!.renderer.visualStats().scatter.pieces > 0, undefined, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const scatter = await page.evaluate(() => window.__cinder!.renderer.visualStats().scatter);
  console.log('[pirate sector scatter]', spots.pirate.id, JSON.stringify(scatter));
  await expect(page.getByTestId('sector-badge')).toContainText('Pirátsky');
  await page.screenshot({ path: out('sk-clutter-pirate') });

  await placeShip(page, spots.near.x, spots.near.y);
  await page.waitForTimeout(6000);
  const planets = await page.evaluate(() => window.__cinder!.renderer.visualStats().planets);
  console.log('[planets next to the gas giant]', planets);
  await page.screenshot({ path: out('sk-planets-near-giant') });
  expect(errors).toEqual([]);
});

test('sectors 1b: UI kit – the sector card in each security and unknown (SK)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/ui-kit.html');
  const cards = page.getByTestId('kit-sector-cards');
  await expect(cards).toBeVisible();
  await expect(cards.locator('.sc-card')).toHaveCount(5);
  await cards.screenshot({ path: out('sk-kit-cards') });
  expect(errors).toEqual([]);
});
