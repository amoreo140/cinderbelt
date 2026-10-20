import { expect, test } from './test';
import type { Page } from '@playwright/test';

// Mirror mode in the shipyard (SL2 E1 T8): M toggles
// it, placing / painting / removing repeat across the axis through the cockpit row in one undo step,
// a blocked copy shows a red ghost with its reason, "os ±½" moves the axis to the seam, Shift+M mirrors
// the selection. Screenshots: test-results/mirror-*.png (or MIRROR_SHOTS=<dir>).

interface YardPart {
  id: number;
  partId: string;
  x: number;
  y: number;
  rot: number;
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SHOTS = env.MIRROR_SHOTS ?? 'test-results';

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

/** Docked at home with armour and engines in storage, the shipyard open. */
async function openShipyard(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.credits = 3000;
    const parts = s.stations.get('home')!.parts;
    parts['armor:1'] = 6;
    parts['engine:1'] = 2;
  });
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await waitTicks(page, 20);
}

async function cellPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([cx, cy]) => window.__cinder!.renderer.hangarCellToScreen(cx, cy, -0.37), [x, y] as const);
}

async function clickCell(page: Page, x: number, y: number, modifiers: 'Shift'[] = []): Promise<void> {
  const p = await cellPoint(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.down();
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

const yardParts = (page: Page): Promise<YardPart[]> =>
  page.evaluate(() => (window.__cinder!.game as unknown as { yard: { draft: { grid: { parts: YardPart[] } } } }).yard.draft.grid.parts);
const partAt = async (page: Page, x: number, y: number): Promise<YardPart | undefined> =>
  (await yardParts(page)).find((p) => p.x === x && p.y === y);
const undoSteps = (page: Page): Promise<number> =>
  page.evaluate(() => (window.__cinder!.game as unknown as { yard: { draft: { undo: unknown[] } } }).yard.draft.undo.length);

test('mirror mode builds a symmetric ship: pairs, one undo step, blocked copy, seam axis, Shift+M', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await openShipyard(page);
  const toast = page.getByTestId('toast');
  const mirrorButton = page.getByTestId('yard-mirror');

  // M switches the mode on: toast, the header button lit, the axis toggle appears
  await page.mouse.move(640, 300);
  await page.keyboard.press('KeyM');
  await expect(toast).toContainText('Zrkadlo zapnuté');
  await expect(mirrorButton).toHaveClass(/is-on/);
  await expect(page.getByTestId('yard-mirror-axis')).toBeVisible();
  // in the dock M is the mirror, not the map
  await expect(page.getByTestId('station-hub')).toBeVisible();

  // a painted armour stroke (1, 2) → (2, 2): the copies land on (1, −2), (2, −2) – one undo step
  await page.getByTestId('palette-armor').click();
  const a = await cellPoint(page, 1, 2);
  const b = await cellPoint(page, 2, 2);
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await partAt(page, 2, -2))?.partId).toBe('armor');
  expect((await partAt(page, 1, -2))?.partId).toBe('armor');
  expect(await undoSteps(page)).toBe(1);

  // side engines: (1, 3) nozzle out (rot 3), the copy (1, −3) gets the mirrored rotation (rot 1)
  await page.getByTestId('palette-engine').click();
  // (R reads the held Shift on the next frame – keep it down until the rotation lands)
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyR');
  await expect.poll(() => page.evaluate(() => (window.__cinder!.game as unknown as { yard: { rot: number } }).yard.rot)).toBe(3);
  await page.keyboard.up('Shift');
  const e = await cellPoint(page, 1, 3);
  await page.mouse.move(e.x, e.y, { steps: 2 });
  await waitTicks(page, 5);
  await page.screenshot({ path: `${SHOTS}/mirror-engine-ghost.png` });
  await clickCell(page, 1, 3);
  await expect.poll(async () => (await partAt(page, 1, 3))?.rot).toBe(3);
  expect(await partAt(page, 1, -3)).toMatchObject({ partId: 'engine', rot: 1 });
  expect(await undoSteps(page)).toBe(2);
  await page.mouse.move(640, 120);
  await waitTicks(page, 5);
  await page.screenshot({ path: `${SHOTS}/mirror-symmetric.png` });

  // one undo removes both engines, redo brings both back
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await yardParts(page)).length).toBe(18);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await yardParts(page)).length).toBe(20);

  // the axis on the seam above the cockpit row (y = ½): armour at (2, 3) would copy onto (2, −2), which
  // already holds armour – the copy ghost is red with its reason and only the original is placed
  await page.getByTestId('palette-armor').click();
  await page.getByTestId('yard-mirror-axis').click();
  await expect(page.getByTestId('yard-mirror-axis')).toHaveClass(/is-on/);
  const blocked = await cellPoint(page, 2, 3);
  await page.mouse.move(blocked.x, blocked.y, { steps: 3 });
  await expect(page.getByTestId('mirror-ghost-reason')).toContainText('Zrkadlová kópia sa nepoloží');
  await waitTicks(page, 5);
  await page.screenshot({ path: `${SHOTS}/mirror-blocked-seam.png` });
  await clickCell(page, 2, 3);
  await expect.poll(async () => (await partAt(page, 2, 3))?.partId).toBe('armor');
  expect((await yardParts(page)).length).toBe(21);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await yardParts(page)).length).toBe(20);
  await page.getByTestId('yard-mirror-axis').click();

  // right click removes a pair, undo returns it
  await page.keyboard.press('Escape'); // palette part off
  const r = await cellPoint(page, 2, 2);
  await page.mouse.click(r.x, r.y, { button: 'right' });
  await expect.poll(async () => (await yardParts(page)).length).toBe(18);
  expect(await partAt(page, 2, -2)).toBeUndefined();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await yardParts(page)).length).toBe(20);

  // Shift+M mirrors the selection: the fuel tank (1, 1) and the radar (1, −1) swap sides
  await clickCell(page, 1, 1, ['Shift']);
  await clickCell(page, 1, -1, ['Shift']);
  await page.mouse.move(640, 300);
  await page.keyboard.press('Shift+KeyM');
  await expect(toast).toContainText('Výber zrkadlený');
  await expect.poll(async () => (await partAt(page, 1, 1))?.partId).toBe('radar');
  expect((await partAt(page, 1, -1))?.partId).toBe('fuelTank');
  await page.keyboard.press('Escape'); // clear the selection

  // the axis stays on the floor with the orbit camera
  await page.keyboard.down('KeyQ');
  await waitTicks(page, 40);
  await page.keyboard.up('KeyQ');
  await waitTicks(page, 30);
  await page.screenshot({ path: `${SHOTS}/mirror-orbit.png` });

  // M again: off, the axis toggle hides; the price counts both copies (6 parts × 10 cr mount fee)
  await page.keyboard.press('KeyM');
  await expect(toast).toContainText('Zrkadlo vypnuté');
  await expect(page.getByTestId('yard-mirror-axis')).toBeHidden();
  await expect(page.getByTestId('yard-commit')).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.grid.parts.length === 20);
  const placed = await page.evaluate(() => window.__cinder!.sim.state.player.grid.parts.map((p) => `${p.partId}@${p.x},${p.y},${p.rot}`));
  for (const k of ['armor@1,2,0', 'armor@1,-2,0', 'armor@2,2,0', 'armor@2,-2,0', 'engine@1,3,3', 'engine@1,-3,1']) expect(placed).toContain(k);
  expect(errors).toEqual([]);
});
