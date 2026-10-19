import { expect, test } from './test';
import type { Browser, Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// Sectors stage 1a – presentation: the map's
// Sectors layer (fills, borders, lanes, names, legend), the HUD badge, the entry notice and the radar
// arc, in Slovak and English. Screenshots go to the output dir (`--output=<dir>`).

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/${name}.png` });

/** Puts the ship (flying, stopped) at a point; the world loads around it. */
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

/** Flies the ship in short hops (the HUD sees every hop – no "tow" jump), stopping after `until`. */
async function walkShip(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, until?: () => Promise<boolean>): Promise<void> {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const n = Math.max(1, Math.ceil(len / 90));
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

/** The nearest depth-1 sector the player has not been to (no explored chunk in it). */
async function freshNeighbour(page: Page): Promise<{ id: string; x: number; y: number }> {
  return page.evaluate(async (paths) => {
    const w = (await import(/* @vite-ignore */ paths[0]!)) as typeof import('../../src/sim/regions/world');
    const s = window.__cinder!.sim.state;
    const world = w.regionWorld(s.seed);
    const visited = new Set<string>();
    for (const key of s.world.explored) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      visited.add(world.field.regionOfChunk(cx, cy).id);
    }
    const here = world.field.regionAt(s.player.body.pos.x, s.player.body.pos.y).id;
    const list = world.regions
      .filter((r) => r.seed.depth === 1 && !visited.has(r.seed.id) && r.seed.id !== here)
      .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y));
    const r = list[0]!;
    return { id: r.seed.id, x: r.seed.x, y: r.seed.y };
  }, ['/src/sim/regions/world.ts']);
}

async function mapViews(page: Page, tag: string): Promise<void> {
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, `${tag}-map-default`);
  const canvas = page.getByTestId('map-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 16; i++) await page.mouse.wheel(0, 200);
  // tiles build within a per-frame budget – the refinement finishes within a few frames
  await page.waitForFunction(() => (window as { __cinderSectorStats?: { missing: number } }).__cinderSectorStats?.missing === 0, undefined, { timeout: 10_000 });
  await page.waitForTimeout(300);
  await shot(page, `${tag}-map-zoomout`);
  const stats = await page.evaluate(() => (window as { __cinderSectorStats?: unknown }).__cinderSectorStats);
  console.log(`[sectors map perf ${tag}]`, JSON.stringify(stats));
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(200);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(900);
  await shot(page, `${tag}-map-zoomin`);
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeHidden();
}

test('sectors: map layer, HUD badge, entry notice and radar arc (SK, 1280×720)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'start');
  await undock(page);
  await page.waitForTimeout(400);
  const badge = page.getByTestId('sector-badge');
  await expect(badge).toContainText('Počiatok');
  await expect(badge).toContainText('Strážený');
  await page.locator('.hud-nav').screenshot({ path: `${test.info().project.outputDir}/sk-hud-badge.png` });

  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map-layer-sectors')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-legend')).toContainText('Pirátsky');
  await expect(page.getByTestId('map-legend')).toContainText('[?] Hlásený');
  await expect(page.getByTestId('map-legend')).toContainText('Cechová cesta');
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeHidden();
  await mapViews(page, 'sk-720');

  // fly into a sector never visited: the full entry notice, then the badge changes
  const target = await freshNeighbour(page);
  const from = await page.evaluate(() => ({ ...window.__cinder!.sim.state.player.body.pos }));
  const notice = page.getByTestId('sector-notice');
  await walkShip(page, from, target, () => notice.isVisible());
  await expect(notice).toBeVisible();
  await page.waitForTimeout(250);
  await shot(page, 'sk-entry-notice');
  const name = (await page.locator('.sc-notice-name').textContent())!;
  await expect(badge).toContainText(name);
  await page.locator('.hud-nav').screenshot({ path: `${test.info().project.outputDir}/sk-hud-badge-new.png` });
  // the radar shows the border just crossed
  await page.locator('.hud-radar').screenshot({ path: `${test.info().project.outputDir}/sk-radar-arc.png` });
  // the notice goes away after 2.5 s of game time
  await expect(notice).toBeHidden({ timeout: 6000 });
  expect(errors).toEqual([]);
});

test('sectors: map at 1920×1080 after an hour of play (SK)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loadFixture(page, 'hour1');
  await undock(page);
  await placeShip(page, 260, 180);
  await page.waitForTimeout(600);
  await mapViews(page, 'sk-1080');
  expect(errors).toEqual([]);
});

async function englishPage(browser: Browser, viewport: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ locale: 'en-US', viewport });
  return context.newPage();
}

test('sectors: English map, badge and entry notice (1280×720 and 1920×1080)', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await englishPage(browser, { width: 1280, height: 720 });
  const errors = trackErrors(page);
  await loadFixture(page, 'start');
  await undock(page);
  await expect(page.getByTestId('sector-badge')).toContainText('Origin');
  await expect(page.getByTestId('sector-badge')).toContainText('Guarded');
  await mapViews(page, 'en-720');
  const target = await freshNeighbour(page);
  const from = await page.evaluate(() => ({ ...window.__cinder!.sim.state.player.body.pos }));
  const notice = page.getByTestId('sector-notice');
  await walkShip(page, from, target, () => notice.isVisible());
  await expect(notice).toContainText('Entering');
  await page.waitForTimeout(250);
  await shot(page, 'en-entry-notice');
  expect(errors).toEqual([]);
  await page.context().close();

  const big = await englishPage(browser, { width: 1920, height: 1080 });
  const errors2 = trackErrors(big);
  await loadFixture(big, 'hour1');
  await undock(big);
  await placeShip(big, 260, 180);
  await big.waitForTimeout(600);
  await mapViews(big, 'en-1080');
  expect(errors2).toEqual([]);
  await big.context().close();
});
