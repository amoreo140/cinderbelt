import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// SL2 E2 "shaped parts" end to end (T-E2E) from the `shapes` fixture (docked at home with the T2 fighter "Ostroha" in shaped
// armour, the wedge (1, 2) at 50 % HP, 4× armor:1 + 2× armor:2 in storage, one shaped template) and
// `shapes-fight` (the same ship in ring 2, a Jackal pair ahead):
// - shipyard: Tab / Shift+Tab cycle the shape in hand and the strip follows; a wedge pair and a wing pair
//   in mirror mode (wing L ↔ R); the hull counter shows "½"; Tab over a placed plate reshapes it (the
//   installation line in "Cena zmien"), over the damaged wedge it shows the repair line; KONTROLA warns
//   about a loosely held wedge and the warning goes after R; a reshape frees cannon arc (tooltip and the
//   V layer); commit → flight screenshots at camera 48 and 100;
// - templates: the shaped ship saves as a `CB2.` code that imports back;
// - service: the damaged wedge repairs for the price of the same HP on a full plate (parity);
// - flight: shaped plates shot off fall away as wrecks that keep their shapes, the hull shows torn edges;
// - language: SK → EN live with the shape strip open.
// Screenshots go to SHAPES_SHOTS (default: the test output dir).

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const shotDir = () => env.SHAPES_SHOTS ?? test.info().outputDir;

interface YardPart {
  id: number;
  partId: string;
  tier: number;
  x: number;
  y: number;
  rot: number;
  shape?: string;
}
interface ShellInfo {
  on: boolean;
  pieces: number;
  tornEdges: number;
}

const MODULES = {
  arcs: '/src/sim/combat/arcs.ts',
  economy: '/src/data/economy.ts',
  hp: '/src/sim/ship/hp.ts',
  stations: '/src/sim/world/stations.ts',
  geometry: '/src/sim/combat/geometry.ts',
  locale: '/src/i18n/locale.ts',
} as const;
type ArcsModule = typeof import('../../src/sim/combat/arcs');
type EconomyModule = typeof import('../../src/data/economy');
type HpModule = typeof import('../../src/sim/ship/hp');
type StationsModule = typeof import('../../src/sim/world/stations');
type GeometryModule = typeof import('../../src/sim/combat/geometry');
type LocaleModule = typeof import('../../src/i18n/locale');

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
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 90_000 });
}

/** Waits until one-shot CSS animations (a modal's fade, a toast) have played – software WebGL is slow. */
async function settleCss(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
  );
}

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  await settleCss(page);
  await page.screenshot({ path: `${shotDir()}/${name}.png`, clip });
}

// ---------------------------------------------------------------- shipyard helpers

/** Window pixel over the centre of a hangar cell (on the floor). */
async function cellPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([cx, cy]) => window.__cinder!.renderer.hangarCellToScreen(cx, cy, -0.37), [x, y] as const);
}

async function hoverCell(page: Page, x: number, y: number): Promise<void> {
  const p = await cellPoint(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await expect.poll(() => page.evaluate(() => (window.__cinder!.game as unknown as { yard: { hover: { x: number; y: number } | null } }).yard.hover)).toEqual({ x, y });
}

async function clickCell(page: Page, x: number, y: number): Promise<void> {
  await hoverCell(page, x, y);
  await page.mouse.down();
  await page.mouse.up();
}

/** A field of the shipyard editor (`Game.yard`): `shape` / `rot` / `tier` of the hand. */
const yardField = <T>(page: Page, field: 'shape' | 'rot' | 'tier'): Promise<T> =>
  page.evaluate((f) => (window.__cinder!.game as unknown as { yard: Record<string, unknown> }).yard[f] as T, field);
const yardParts = (page: Page): Promise<YardPart[]> =>
  page.evaluate(() => (window.__cinder!.game as unknown as { yard: { draft: { grid: { parts: YardPart[] } } } }).yard.draft.grid.parts);
const partAt = async (page: Page, x: number, y: number): Promise<YardPart | undefined> =>
  (await yardParts(page)).find((p) => p.x === x && p.y === y);
const handShape = (page: Page) => yardField<string | null>(page, 'shape');
const handRot = (page: Page) => yardField<number>(page, 'rot');

/** Presses R (or Shift+R) until the hand holds rotation `rot`. */
async function handRotation(page: Page, rot: number): Promise<void> {
  for (let i = 0; i < 4 && (await handRot(page)) !== rot; i++) {
    const before = await handRot(page);
    await page.keyboard.press('KeyR');
    await expect.poll(() => handRot(page)).not.toBe(before);
  }
  expect(await handRot(page)).toBe(rot);
}

/** The "N × 10 kr = …" installation count of the "Cena zmien" panel (0 = no line / none). */
async function installCount(page: Page): Promise<number> {
  const text = (await page.getByTestId('yard-cost').innerText()).replace(/\s+/g, ' ');
  const m = /(\d+) × 10/.exec(text);
  return m ? Number(m[1]) : 0;
}

/** Widths (degrees) of each cannon's effective arc in the draft (sim) and as drawn by the V layer (render). */
async function cannonArcs(page: Page): Promise<{ sim: number; drawn: number; layers: boolean }> {
  return page.evaluate(async (modules) => {
    const { effectiveArcs, arcsWidth } = (await import(/* @vite-ignore */ modules.arcs)) as ArcsModule;
    type Grid = Parameters<ArcsModule['effectiveArcs']>[0];
    const grid = (window.__cinder!.game as unknown as { yard: { draft: { grid: Grid } } }).yard.draft.grid;
    const sim = grid.parts.filter((p) => p.partId === 'cannon').reduce((s, p) => s + arcsWidth(effectiveArcs(grid, p)), 0);
    const hangar = window.__cinder!.renderer.hangar as unknown as {
      layerGroup: { visible: boolean; children: { geometry?: { type: string; parameters?: { innerRadius: number; outerRadius: number; thetaLength: number } } }[] };
    };
    let drawn = 0;
    for (const c of hangar.layerGroup.children) {
      const p = c.geometry?.type === 'RingGeometry' ? c.geometry.parameters : undefined;
      // the cannon arc fill: RingGeometry(0.2, 2.3, …) (HangarView.cannonArcGeometry)
      if (p && p.innerRadius === 0.2 && p.outerRadius === 2.3) drawn += p.thetaLength;
    }
    const deg = 180 / Math.PI;
    return { sim: Math.round(sim * deg), drawn: Math.round(drawn * deg), layers: hangar.layerGroup.visible };
  }, MODULES);
}

/**
 * The damaged wedge's repair: its own quote and the parity price – the same HP missing on a full plate of
 * the tier – and the "naive" price of the wedge's HP share on a full plate (what a missing area factor
 * would charge).
 */
function wedgeRepair(page: Page) {
  return page.evaluate(async (modules) => {
    const { repairCost } = (await import(/* @vite-ignore */ modules.economy)) as EconomyModule;
    const { currentHp, maxHp, fullMaxHp } = (await import(/* @vite-ignore */ modules.hp)) as HpModule;
    const { homeStation } = (await import(/* @vite-ignore */ modules.stations)) as StationsModule;
    const pl = window.__cinder!.sim.state.player;
    const wedge = pl.grid.parts.find((p) => p.shape === 'wedge' && currentHp(pl.hp, p) < maxHp(p))!;
    const hp = currentHp(pl.hp, wedge);
    const max = maxHp(wedge);
    const full = fullMaxHp(wedge);
    const ring = homeStation().ring;
    const key = `armor:${wedge.tier}` as Parameters<EconomyModule['repairCost']>[0];
    return {
      id: wedge.id,
      hp,
      max,
      // the same HP missing on a full plate of the tier
      parity: repairCost(key, full - (max - hp), full, ring),
      // the full plate's price for the wedge's own HP share (what a missing hpMult would charge)
      naive: repairCost(key, (hp / max) * full, full, ring),
    };
  }, MODULES);
}

/** Setup: the material of the wedge's repair in the home storage (the fixture has none). */
async function stockRepairMaterial(page: Page, repair: Awaited<ReturnType<typeof wedgeRepair>>): Promise<void> {
  await page.evaluate(({ material, amount }) => {
    window.__cinder!.sim.state.stations.get('home')!.resources[material] += amount;
  }, { material: repair.parity.material, amount: repair.parity.amount });
}

/** The pointer off the hangar and off any button (no ghost, no tooltip in a screenshot). */
const parkMouse = (page: Page) => page.mouse.move(150, 600);

async function openShipyard(page: Page): Promise<void> {
  await expect(page.getByTestId('station-hub')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await waitTicks(page, 20);
}

// ---------------------------------------------------------------- flight helpers

const setZoom = (page: Page, d: number) =>
  page.evaluate((v) => {
    (window.__cinder!.renderer as unknown as { rig: { distance: number } }).rig.distance = v;
  }, d);
const hideUi = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    document.getElementById('ui')!.style.display = h ? 'none' : '';
  }, hidden);
const setPaused = (page: Page, paused: boolean) => page.evaluate((p) => (window.__cinder!.game as unknown as { setPaused(p: boolean): void }).setPaused(p), paused);
/** A halted game redraws with a zero frame time: a few manual frames settle the camera on the ship. */
const settleScene = (page: Page) =>
  page.evaluate(() => {
    const r = window.__cinder!.renderer as unknown as { render(alpha: number, dt: number, aim: null): void };
    for (let i = 0; i < 12; i++) r.render(1, 0.25, null);
  });
const playerPos = (page: Page) => page.evaluate(() => ({ ...window.__cinder!.sim.state.player.body.pos }));
const playerShell = (page: Page) => page.evaluate(() => (window.__cinder!.renderer as unknown as { shipView: { shellInfo: ShellInfo } }).shipView.shellInfo);

/** Screen clip (CSS px) of `w` × `h` around a sim point, kept inside the 1280 × 720 viewport. */
async function clipAt(page: Page, at: { x: number; y: number }, w: number, h: number) {
  const c = await page.evaluate((q) => window.__cinder!.renderer.worldToScreen(q), at);
  return { x: Math.min(1280 - w, Math.max(0, c.x - w / 2)), y: Math.min(720 - h, Math.max(0, c.y - h / 2)), width: w, height: h };
}

/**
 * Flight screenshots at camera distance 48 and 100 (+ 20 with `close`, for the comparison with the art
 * previews' close-ups): the sim halted, the UI hidden, full frame + crop around `at` (default the ship).
 */
async function flightShots(page: Page, tag: string, at?: { x: number; y: number }, close = false): Promise<void> {
  await setPaused(page, true);
  await hideUi(page, true);
  for (const d of close ? [48, 100, 20] : [48, 100]) {
    await setZoom(page, d);
    await settleScene(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${shotDir()}/${tag}-${d}.png` });
    await page.screenshot({ path: `${shotDir()}/${tag}-${d}-crop.png`, clip: await clipAt(page, at ?? (await playerPos(page)), d === 100 ? 300 : 420, d === 100 ? 220 : 300) });
  }
  await hideUi(page, false);
  await setPaused(page, false);
}

// High graphics (as the art previews), no combat zoom-out: the screenshots pick their camera distance
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('cinderbelt.settings')) localStorage.setItem('cinderbelt.settings', JSON.stringify({ graphicsQuality: 'high', combatZoom: false }));
  });
});

test.describe.configure({ mode: 'parallel' });

test('shipyard: Tab and the strip, mirrored wedge and wing pairs, ½ points, reshape, repair line, loose warning, arc gain; commit and fly', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'shapes', { ticks: 10 });
  // without the material the shipyard scraps the damaged wedge instead of repairing it (damagedScrapped)
  const repair = await wedgeRepair(page);
  await stockRepairMaterial(page, repair);
  await openShipyard(page);
  const strip = page.getByTestId('yard-shapes');
  const hull = page.getByTestId('yard-hull-points');
  const check = page.getByTestId('yard-check');
  const toast = page.getByTestId('toast');
  await expect(hull).toHaveText('23½ / 48 b');
  await expect(strip).toBeHidden();

  // armour in hand: the strip shows "Full"; Tab / Shift+Tab cycle the hand and the strip follows
  await page.getByTestId('palette-armor').click();
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute('data-active', 'full');
  await page.mouse.move(640, 300);
  await page.keyboard.press('Tab');
  await expect(strip).toHaveAttribute('data-active', 'wedge');
  await expect(page.getByTestId('yard-shape-active')).toContainText('Klin');
  await expect(page.getByTestId('yard-shape-wedge')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Tab');
  await expect(strip).toHaveAttribute('data-active', 'chamfer');
  await page.keyboard.press('Shift+Tab');
  await expect(strip).toHaveAttribute('data-active', 'wedge');
  expect(await handShape(page)).toBe('wedge');
  // Shift+Tab from "Full" wraps to the last shape, Tab brings it back
  await page.keyboard.press('Shift+Tab');
  await expect(strip).toHaveAttribute('data-active', 'full');
  await page.keyboard.press('Shift+Tab');
  await expect(strip).toHaveAttribute('data-active', 'nose2x1');
  await page.keyboard.press('Tab');
  await expect(strip).toHaveAttribute('data-active', 'full');
  await page.keyboard.press('Tab');
  await expect(strip).toHaveAttribute('data-active', 'wedge');
  await hoverCell(page, 3, 2);
  await waitTicks(page, 5);
  await shot(page, 'yard-sk-strip');

  // mirror mode: a wedge at (0, 3) → its twin at (0, −3) turned (rot 3); one undo step
  await page.keyboard.press('KeyM');
  await expect(toast).toContainText('Zrkadlo zapnuté');
  await hoverCell(page, 0, 3);
  await expect(page.getByTestId('yard-ghost')).toHaveAttribute('data-shape', 'wedge');
  await expect(page.getByTestId('yard-shape-tip')).toContainText('½ b');
  await waitTicks(page, 5);
  await shot(page, 'yard-sk-wedge-ghost');
  await clickCell(page, 0, 3);
  await expect.poll(async () => (await partAt(page, 0, -3))?.shape).toBe('wedge');
  expect(await partAt(page, 0, 3)).toMatchObject({ partId: 'armor', shape: 'wedge', rot: 0 });
  expect((await partAt(page, 0, -3))?.rot).toBe(3);
  await expect(hull).toHaveText('24½ / 48 b');

  // a wing pair: wing L at (−5, 2) turned to the stern (rot 2) → wing R at (−5, −2)
  for (const s of ['chamfer', 'round', 'arc', 'half', 'nose', 'wingL']) {
    await page.keyboard.press('Tab');
    await expect(strip).toHaveAttribute('data-active', s);
  }
  await handRotation(page, 2);
  await clickCell(page, -5, 2);
  await expect.poll(async () => (await partAt(page, -5, -2))?.shape).toBe('wingR');
  expect(await partAt(page, -5, 2)).toMatchObject({ partId: 'armor', shape: 'wingL', rot: 2 });
  expect((await partAt(page, -5, -2))?.rot).toBe(2);
  // half points: 23½ + 2 × ½ + 2 × 1
  await expect(hull).toHaveText('26½ / 48 b');
  await expect(check.locator('[data-code="shapeLooseContact"]')).toHaveCount(0);
  await parkMouse(page);
  await waitTicks(page, 5);
  await shot(page, 'yard-sk-mirror-pairs');

  // arc gain: a full T2 plate pair diagonal to the cannons, turned so the wedge frees the arc
  await page.getByTestId('yard-shape-full').click();
  await page.keyboard.press('KeyT');
  await expect.poll(() => yardField<number>(page, 'tier')).toBe(2);
  await page.mouse.move(640, 300);
  await handRotation(page, 3);
  await hoverCell(page, 2, 2);
  // the full plate in hand takes arc from the cannon (1, 1)
  await expect(page.getByTestId('yard-shape-tip')).toContainText('výseku pre kanón (1,1)');
  await expect(page.getByTestId('yard-shape-tip')).toContainText('−');
  await clickCell(page, 2, 2);
  await expect.poll(async () => (await partAt(page, 2, -2))?.partId).toBe('armor');
  // the V layer (on by default) draws what the sim computes
  await expect.poll(async () => { const a = await cannonArcs(page); return a.drawn - a.sim; }).toBe(0);
  const fullArcs = await cannonArcs(page);
  expect(fullArcs.layers).toBe(true);
  // empty hand over the plate: the card says what Tab makes of it and how much arc it frees
  await page.keyboard.press('Escape');
  await hoverCell(page, 2, 2);
  const card = page.getByTestId('yard-reshape');
  await expect(card).toContainText('Plný → Klin');
  await expect(page.getByTestId('yard-reshape-tip')).toContainText('+26° výseku pre kanón (1,1)');
  await waitTicks(page, 5);
  await shot(page, 'yard-sk-arc-tip');
  const installs0 = await installCount(page);
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await partAt(page, 2, 2))?.shape).toBe('wedge');
  expect((await partAt(page, 2, -2))?.shape).toBe('wedge');
  // the V layer draws the freed arc: +26° on each cannon
  await expect.poll(async () => (await cannonArcs(page)).sim).toBe(fullArcs.sim + 52);
  await expect.poll(async () => (await cannonArcs(page)).drawn).toBe(fullArcs.sim + 52);
  // plates laid in this draft are installed once, whatever their shape
  expect(await installCount(page)).toBe(installs0);
  await parkMouse(page);
  await waitTicks(page, 5);
  await shot(page, 'yard-sk-layer-on');
  await page.keyboard.press('KeyV');
  await expect.poll(async () => (await cannonArcs(page)).layers).toBe(false);
  await waitTicks(page, 5);
  await shot(page, 'yard-sk-layer-off');
  await page.keyboard.press('KeyV');
  await expect.poll(async () => (await cannonArcs(page)).layers).toBe(true);
  await page.keyboard.press('KeyM');
  await expect(toast).toContainText('Zrkadlo vypnuté');

  // Tab over a placed full-HP plate: the chamfer (0, 2) → round corner in place, + one installation
  await hoverCell(page, 0, 2);
  await expect(card).toContainText('Zrezaný roh → Oblý roh');
  const installs1 = await installCount(page);
  const chamferId = (await partAt(page, 0, 2))!.id;
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await partAt(page, 0, 2))?.shape).toBe('round');
  expect((await partAt(page, 0, 2))!.id).toBe(chamferId);
  await expect.poll(() => installCount(page)).toBe(installs1 + 1);
  await expect(page.getByTestId('yard-cost')).toContainText('Montáž');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await partAt(page, 0, 2))?.shape).toBe('chamfer');

  // Tab over the damaged wedge (1, 2): it is laid anew – the repair is priced in "Cena zmien"
  await hoverCell(page, 1, 2);
  await expect(card).toContainText('Klin → ');
  const costLines = page.getByTestId('yard-cost');
  await expect(costLines).not.toContainText('Oprava pri demontáži');
  await page.keyboard.press('Tab');
  await expect(toast).toContainText('Poškodený diel sa pri pretvarovaní opraví');
  // priced like the service: the missing HP as on a full plate
  await expect(costLines.locator('.yd-cost-line', { hasText: 'Oprava pri demontáži' })).toContainText(`${repair.parity.credits} kr`);
  await expect.poll(async () => (await partAt(page, 1, 2))?.shape).not.toBe('wedge');
  await waitTicks(page, 5);
  await shot(page, 'yard-sk-damaged-reshape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await partAt(page, 1, 2))?.shape).toBe('wedge');
  await expect(costLines).not.toContainText('Oprava pri demontáži');

  // KONTROLA: the wedge (0, 3) turned to rot 3 holds by its tip only – R turns it back and the warning goes
  const loose = check.locator('[data-code="shapeLooseContact"]');
  const looseBefore = await loose.count();
  await hoverCell(page, 0, 3);
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await partAt(page, 0, 3))?.rot).toBe(3);
  await page.keyboard.up('Shift');
  await expect(loose).toHaveCount(looseBefore + 1);
  await expect(check).toContainText('Klin drží len hrotom – zváž otočenie.');
  await parkMouse(page);
  await waitTicks(page, 5);
  await shot(page, 'yard-sk-loose');
  await hoverCell(page, 0, 3);
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await partAt(page, 0, 3))?.rot).toBe(0);
  await expect(loose).toHaveCount(looseBefore);

  // confirm: the shapes reach the ship
  const draft = (await yardParts(page)).map((p) => `${p.partId}@${p.x},${p.y}r${p.rot}${p.shape ?? ''}`).sort();
  await parkMouse(page);
  await waitTicks(page, 3);
  await shot(page, 'yard-sk-final');
  await expect(page.getByTestId('yard-commit')).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => window.__cinder!.sim.state.player.grid.parts.length === n, draft.length);
  const ship = await page.evaluate(() => window.__cinder!.sim.state.player.grid.parts.map((p) => `${p.partId}@${p.x},${p.y}r${p.rot}${p.shape ?? ''}`).sort());
  expect(ship).toEqual(draft);

  // fly: the shaped ship at camera 48 and 100
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', undefined, { timeout: 60_000 });
  await waitTicks(page, 120);
  expect((await playerShell(page)).on).toBe(true);
  await flightShots(page, 'flight-sk-shaped', undefined, true);
  expect(errors).toEqual([]);
});

test('templates: the shaped ship saves as a CB2 code that imports back', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'shapes', { ticks: 10 });
  await expect(page.getByTestId('station-hub')).toBeVisible({ timeout: 60_000 });
  const names = () => page.evaluate(() => window.__cinder!.sim.state.templates.map((t) => t.name));
  expect(await names()).toEqual(['Ostroha']);
  await page.getByTestId('tab-shipyard').click();
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await page.getByTestId('yard-open-templates').click();
  await expect(page.getByTestId('templates')).toBeVisible();

  await page.getByTestId('templates-name').fill('Ostroha 2');
  await page.getByTestId('templates-save-btn').click();
  await expect.poll(names).toEqual(['Ostroha', 'Ostroha 2']);
  const saved = await page.evaluate(() => window.__cinder!.sim.state.templates[1]!.parts);
  expect(saved.filter((p) => p.length > 4).length).toBe(7); // nose 2×1, 2 chamfers, 2 wedges, 2 wings
  await page.getByTestId('template-export-1').click();
  const field = page.getByTestId('templates-export-code');
  await expect(field).toBeVisible();
  const code = await field.inputValue();
  expect(code).toMatch(/^CB2\./);
  await shot(page, 'templates-sk-export');

  await page.getByTestId('template-delete-1').click();
  await page.locator('[data-modal="confirm"] button').click();
  await expect.poll(names).toEqual(['Ostroha']);
  await page.getByTestId('templates-import-code').fill(code);
  await page.getByTestId('templates-import-btn').click();
  await expect(page.getByTestId('templates-import-result')).toHaveClass(/is-ok/);
  await expect.poll(names).toEqual(['Ostroha', 'Ostroha 2']);
  expect(await page.evaluate(() => window.__cinder!.sim.state.templates[1]!.parts)).toEqual(saved);
  await shot(page, 'templates-sk-imported');
  expect(errors).toEqual([]);
});

test('service: the damaged wedge repairs for the price of the same HP on a full plate', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'shapes', { ticks: 10 });
  await expect(page.getByTestId('station-hub')).toBeVisible({ timeout: 60_000 });
  const quote = await wedgeRepair(page);
  expect(quote.hp).toBe(quote.max / 2);
  expect(quote.parity.credits).toBeLessThan(quote.naive.credits);
  // the price is the repair alone (no auto-buy of the material)
  await stockRepairMaterial(page, quote);
  await page.keyboard.press('Digit1');
  await expect(page.getByTestId('repairs')).toBeVisible();
  const row = page.getByTestId(`repair-row-${quote.id}`);
  await expect(row).toContainText(`${Math.round(quote.hp)} / ${quote.max}`);
  const rowText = (await row.locator('td.num').innerText()).replace(/\s+/g, ' ');
  expect(rowText).toMatch(new RegExp(`^${quote.parity.credits} kr \\+ ${quote.parity.amount} `));
  await shot(page, 'service-sk-wedge');
  const credits0 = await page.evaluate(() => window.__cinder!.sim.state.credits);
  await page.getByTestId(`repair-${quote.id}`).click();
  await expect(page.getByTestId('repairs-ok')).toBeVisible();
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(credits0 - quote.parity.credits);
  expect(await page.evaluate((id) => window.__cinder!.sim.state.player.hp.has(id), quote.id)).toBe(false);
  expect(errors).toEqual([]);
});

test('flight: shaped plates shot off fall away as wrecks that keep their shapes; the hull shows torn edges', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'shapes-fight', { ticks: 20 });
  await expect.poll(async () => (await playerShell(page)).on).toBe(true);
  expect((await playerShell(page)).tornEdges).toBe(0);
  await flightShots(page, 'flight-sk-fight');

  // the Jackals' shots (setup: aimed at the parts that hold the bow nose and the wedges, shield down):
  // the cannons, the chamfers and the bow plate go, the nose 2×1 and both wedges break off
  const wrecks0 = await page.evaluate(() => window.__cinder!.sim.state.combat.wrecks.length);
  await page.evaluate(async (modules) => {
    const { gridToWorld } = (await import(/* @vite-ignore */ modules.geometry)) as GeometryModule;
    const s = window.__cinder!.sim.state;
    const pl = s.player;
    pl.shield = 0;
    const owner = s.combat.enemies[0]!.id;
    const targets = pl.grid.parts.filter((p) => p.partId === 'cannon' || p.shape === 'chamfer' || (p.partId === 'armor' && p.x === 1 && p.y === 0));
    for (const p of targets) {
      const at = gridToWorld(pl.body, pl.props.centerOfMass, { x: p.x, y: p.y });
      s.combat.projectiles.push({ id: s.combat.nextId++, owner, pos: at, vel: { x: 0.01, y: 0 }, ttl: 5, damage: 9999, tier: 2, origin: at });
    }
  }, MODULES);
  await expect
    .poll(() => page.evaluate(() => window.__cinder!.sim.state.player.grid.parts.filter((p) => p.shape === 'wedge' || p.shape === 'nose2x1').length))
    .toBe(0);
  const pieces = await page.evaluate(
    (n) =>
      window.__cinder!.sim.state.combat.wrecks
        .slice(n)
        .map((w) => w.grid.parts.map((p) => p.shape ?? p.partId).join('+'))
        .sort(),
    wrecks0,
  );
  expect(pieces).toEqual(['nose2x1', 'wedge', 'wedge']);
  // the hull shell rebuilt with torn edges where the parts were; the wrecks' views carry the shaped plates
  await expect.poll(async () => (await playerShell(page)).tornEdges).toBeGreaterThan(0);
  // (the batch merges the part nodes away – the view's decal parts keep the node each part was built as)
  const views = await page.evaluate(() => {
    type Entry = { view: { decalParts: { node: { name: string } }[] } };
    const layer = (window.__cinder!.renderer as unknown as { combat: { wrecks: Map<number, Entry> } }).combat;
    const names: string[] = [];
    for (const [, e] of layer.wrecks) for (const d of e.view.decalParts) if (d.node.name.startsWith('Armor_')) names.push(d.node.name);
    return names.sort();
  });
  expect(views).toEqual(['Armor_nose2x1', 'Armor_wedge', 'Armor_wedge']);
  // the wrecks drift off – the frame centred between the ship and them
  await waitTicks(page, 30);
  const centre = await page.evaluate((n) => {
    const s = window.__cinder!.sim.state;
    const ws = s.combat.wrecks.slice(n);
    const pts = [s.player.body.pos, ...ws.map((w) => w.body.pos)];
    return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
  }, wrecks0);
  await flightShots(page, 'flight-sk-shot-off', centre, true);
  expect(errors).toEqual([]);
});

test('language: SK → EN live with the shape strip open', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'shapes', { ticks: 10 });
  await openShipyard(page);
  await page.getByTestId('palette-armor').click();
  const strip = page.getByTestId('yard-shapes');
  await page.mouse.move(640, 300);
  await page.keyboard.press('Tab');
  await expect(strip).toHaveAttribute('data-active', 'wedge');
  await expect(strip).toContainText('Tvar');
  await expect(page.getByTestId('yard-shape-active')).toContainText('Klin');
  await hoverCell(page, 0, 3);
  await expect(page.getByTestId('yard-shape-tip')).toContainText('½ b');

  // the language switch (what Settings → Jazyk does): the open shipyard follows on its next frame
  await page.evaluate(async (modules) => {
    const { setLocale } = (await import(/* @vite-ignore */ modules.locale)) as LocaleModule;
    // resolves once the English texts are loaded and switched to
    await setLocale('en');
  }, MODULES);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(strip).toHaveAttribute('data-active', 'wedge');
  await expect(page.getByTestId('yard-shape-active')).toContainText('Wedge');
  await expect(page.getByTestId('yard-shape-tip')).toContainText('½ pt');
  await expect(page.getByTestId('yard-hull-points')).toHaveText('23½ / 48 pts');
  // the part panel follows at once too (its cache is keyed by the language as well)
  await expect(page.getByTestId('yard-part-detail')).toContainText(/on your design/i);
  expect(await page.getByTestId('yard-part-detail').innerText()).not.toMatch(/[áäčďéíĺľňóôŕšťúýž]/i);
  await waitTicks(page, 5);
  await shot(page, 'yard-en-strip');

  // an empty hand over the placed wedge: the reshape card in English; a loose wedge warns in English
  await page.keyboard.press('Escape');
  await hoverCell(page, 1, -2);
  await expect(page.getByTestId('yard-reshape')).toContainText('Wedge → ');
  await waitTicks(page, 5);
  await shot(page, 'yard-en-reshape');
  // (the hand keeps its last shape when armour is picked again)
  await page.getByTestId('palette-armor').click();
  await expect(strip).toHaveAttribute('data-active', 'wedge');
  await page.mouse.move(640, 300);
  await handRotation(page, 2);
  await clickCell(page, 0, 3);
  await expect.poll(async () => (await partAt(page, 0, 3))?.shape).toBe('wedge');
  await expect(page.getByTestId('yard-check').locator('[data-code="shapeLooseContact"]')).toHaveCount(1);
  await expect(page.getByTestId('yard-check')).toContainText('Wedge holds on only by a tip');
  await expect(page.getByTestId('yard-part-detail')).toContainText(/on your design/i);
  await parkMouse(page);
  await waitTicks(page, 5);
  await shot(page, 'yard-en-loose');
  for (const id of ['yard-check', 'yard-cost', 'yard-stats', 'yard-shapes', 'yard-part-detail']) {
    expect(await page.getByTestId(id).innerText(), id).not.toMatch(/[áäčďéíĺľňóôŕšťúýž]/i);
  }

  // confirm (a warning does not block) and fly: the HUD in English with the shaped silhouette
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.grid.parts.length === 25);
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', undefined, { timeout: 60_000 });
  await waitTicks(page, 120);
  await setZoom(page, 48);
  await waitTicks(page, 30);
  await shot(page, 'flight-en-hud-48');
  expect(errors).toEqual([]);
});
