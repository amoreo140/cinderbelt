import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// Shipyard 2.0: free placement
// (loose parts marked, confirm blocked), group selection (Shift + click / drag, double click, Ctrl+A)
// and group moves with a ghost. Screenshots: test-results/shipyard2-*.png.

interface YardPart {
  id: number;
  partId: string;
  x: number;
  y: number;
  rot: number;
}

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

/** Docked at home with parts in storage, the shipyard open. */
async function openShipyard(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.credits = 2000;
    const parts = s.stations.get('home')!.parts;
    parts['armor:1'] = 3;
  });
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await waitTicks(page, 20);
}

/** Window pixel over the centre of a hangar cell (on the floor). */
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
const selection = (page: Page): Promise<number[]> =>
  page.evaluate(() => [...(window.__cinder!.game as unknown as { yard: { selection: readonly number[] } }).yard.selection]);
const partAt = async (page: Page, x: number, y: number): Promise<YardPart | undefined> =>
  (await yardParts(page)).find((p) => p.x === x && p.y === y);

test('Shipyard 2.0: loose parts are marked and block confirm; box-selected and dragged on, the ship confirms', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openShipyard(page);

  // three armour plates placed loose on the hangar floor, away from the ship
  await page.getByTestId('palette-armor').click();
  for (const [x, y] of [[4, 4], [5, 4], [5, 5]] as const) await clickCell(page, x, y);
  await page.keyboard.press('Escape'); // palette part off
  await expect.poll(async () => (await yardParts(page)).length).toBe(17);
  const check = page.getByTestId('yard-check');
  await expect(check.locator('.yd-msg').first()).toContainText('3 diely nie sú spojené s kokpitom');
  const commit = page.getByTestId('yard-commit');
  await expect(commit).toHaveAttribute('aria-disabled', 'true');
  await page.mouse.move(640, 120);
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/shipyard2-loose.png' });
  // the blocked confirm says why
  await commit.hover();
  await expect(page.getByRole('tooltip')).toContainText('nie sú spojené s kokpitom');
  await waitTicks(page, 5);
  await page.screenshot({ path: 'test-results/shipyard2-confirm-blocked.png' });

  // leaving asks: the dialog says the loose parts cannot be confirmed; back = keep editing
  await page.mouse.move(640, 300);
  await page.keyboard.press('Escape');
  const dialog = page.getByRole('dialog');
  await expect(page.getByTestId('yard-prompt-loose')).toContainText('nepripojené diely');
  await dialog.getByRole('button', { name: /Späť k návrhu/ }).click();
  await expect(dialog).toBeHidden();

  // Shift + drag a box around the loose piece (the box is drawn while dragging)
  const a = await cellPoint(page, 4, 3);
  const b = await cellPoint(page, 6, 6);
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await waitTicks(page, 5);
  await page.screenshot({ path: 'test-results/shipyard2-box.png' });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const loose = (await yardParts(page)).filter((p) => p.x >= 4).map((p) => p.id);
  await expect.poll(() => selection(page)).toEqual(loose);
  await expect(page.getByTestId('yard-selection')).toContainText('3 diely vybrané');

  // drag the piece by (4, 4) next to the hull: (1, 2), (2, 2), (2, 3)
  const from = await cellPoint(page, 4, 4);
  const to = await cellPoint(page, 1, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await partAt(page, 2, 3))?.partId).toBe('armor');
  expect((await partAt(page, 1, 2))?.partId).toBe('armor');
  await expect(commit).not.toHaveAttribute('aria-disabled', 'true');
  await expect(check).not.toContainText('nie sú spojené');

  // one undo step brings the whole piece back out, redo connects it again
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await partAt(page, 5, 5))?.partId).toBe('armor');
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await partAt(page, 2, 3))?.partId).toBe('armor');

  // confirm: 3 parts from storage, 3 × 10 cr mount fee – the loose stage cost nothing extra
  await page.mouse.move(640, 300);
  await page.keyboard.press('Escape'); // clear the selection
  await expect(page.getByTestId('yard-selection')).toBeHidden();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.grid.parts.length === 17);
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(2000 - 30);
  expect(errors).toEqual([]);
});

test('Shipyard 2.0: move an engine group to the stern in one drag; box select, Ctrl+A, delete, double click', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openShipyard(page);
  const mem0 = await page.evaluate(() => window.__cinder!.renderer.memoryInfo());

  // the two side thrusters (0, ±2) – Shift + click each
  await clickCell(page, 0, 2, ['Shift']);
  await clickCell(page, 0, -2, ['Shift']);
  const side = [(await partAt(page, 0, 2))!.id, (await partAt(page, 0, -2))!.id];
  await expect.poll(() => selection(page)).toEqual(side);

  // grab the upper one; over the fuel tank the ghost shows that part red, the other green
  const from = await cellPoint(page, 0, 2);
  const over = await cellPoint(page, 1, 1);
  const to = await cellPoint(page, -1, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(over.x, over.y, { steps: 6 });
  await waitTicks(page, 5);
  const ghost = await page.evaluate(() => {
    const g = (window.__cinder!.game as unknown as { yard: { groupGhost(): { cells: { ok: boolean }[] } | null } }).yard.groupGhost();
    return g?.cells.map((c) => c.ok);
  });
  expect(ghost).toEqual([true, false]); // part 13 (lower) is free, 14 lands on the fuel tank
  await page.screenshot({ path: 'test-results/shipyard2-group-drag.png' });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await partAt(page, -1, 2))?.partId).toBe('engine');
  expect((await partAt(page, -1, -2))?.partId).toBe('engine');
  expect(await partAt(page, 0, 2)).toBeUndefined();
  await expect(page.getByTestId('yard-cost')).toContainText('2 × 10');
  await expect(page.getByTestId('yard-commit')).not.toHaveAttribute('aria-disabled', 'true');

  // Escape clears the selection first (the draft stays)
  await page.mouse.move(640, 300);
  await page.keyboard.press('Escape');
  await expect.poll(() => selection(page)).toEqual([]);
  await expect(page.getByRole('dialog')).toBeHidden();

  // Ctrl+A selects the whole ship, Delete sends it all to storage (one undo step)
  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await selection(page)).length).toBe(14);
  await waitTicks(page, 5);
  await page.screenshot({ path: 'test-results/shipyard2-select-all.png' });
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await yardParts(page)).length).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await yardParts(page)).length).toBe(14);

  // double click: the whole connected piece
  const c = await cellPoint(page, 1, 0);
  await page.mouse.dblclick(c.x, c.y);
  await expect.poll(async () => (await selection(page)).length).toBe(14);
  await page.keyboard.press('Escape');

  // confirm the moved thrusters: 2 × 10 cr
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    window.__cinder!.sim.state.player.grid.parts.some((p) => p.partId === 'engine' && p.x === -1 && p.y === 2),
  );
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(2000 - 20);
  const mem1 = await page.evaluate(() => window.__cinder!.renderer.memoryInfo());
  expect(mem1.geometries).toBeLessThanOrEqual(mem0.geometries + 8);
  expect(errors).toEqual([]);
});

test('SL2 E2 shapes: the effect counts the shape in hand, an empty hand previews the reshape, the bow marker stays clear', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'shapes', { ticks: 10 });
  await expect(page.getByTestId('station-hub')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  // 1280 × 720: the bow marker is not under the "Top view" button
  const bow = (await page.locator('.yd-bow').boundingBox())!;
  const top = (await page.getByTestId('yard-top-view').boundingBox())!;
  expect(bow.x >= top.x + top.width || bow.x + bow.width <= top.x || bow.y >= top.y + top.height).toBe(true);
  // armour in hand: a wedge adds half a plate's HP to the draft
  await page.getByTestId('palette-armor').click();
  const effect = page.getByTestId('yard-part-detail').getByTestId('part-effect');
  await expect(effect).toContainText('+40 HP');
  await page.getByTestId('yard-shape-wedge').click();
  await expect(effect).toContainText('+20 HP');
  // with the strip shown the parts list still has room at 720p
  expect((await page.locator('.yd-pal-list').boundingBox())!.height).toBeGreaterThan(220);
  // an empty hand over the placed wedge: the card shows what Tab reshapes it to
  await page.keyboard.press('Escape');
  const wedge = (await yardParts(page)).find((p) => p.partId === 'armor' && (p as YardPart & { shape?: string }).shape === 'wedge')!;
  const at = await cellPoint(page, wedge.x, wedge.y);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  const card = page.getByTestId('yard-reshape');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Klin → Zrezaný roh');
  await expect(page.getByTestId('yard-reshape-tip')).toContainText('HP');
  await page.keyboard.press('Tab');
  await expect(card).toContainText('Zrezaný roh → ');
  expect(errors).toEqual([]);
});
