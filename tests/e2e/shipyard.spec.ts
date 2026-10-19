import { expect, test } from './test';
import type { Page } from '@playwright/test';

// M2b: crafting → shipyard → placing a part with the mouse → couplings → confirmation → departure with a bigger ship.
// Screenshots test-results/m2b-*.png (crafting, parts market, editor, repairs).

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

async function start(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
}

/** Window pixel above the centre of a hangar cell (on the floor). */
async function cellPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([cx, cy]) => window.__cinder!.renderer.hangarCellToScreen(cx, cy, -0.37), [x, y] as const);
}

async function hoverCell(page: Page, x: number, y: number): Promise<void> {
  const p = await cellPoint(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
}

const draftParts = (page: Page) =>
  page.evaluate(() => (window.__cinder!.game as unknown as { yard: { draft: { grid: { parts: unknown[] } } } }).yard.draft.grid.parts.length);
const connectors = (page: Page) => page.evaluate(() => window.__cinder!.renderer.hangar.connectorCount);

test('M2b: craft a cargo hold, mount it in the shipyard with the mouse and fly off bigger', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await start(page);
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.credits = 1500;
    s.player.cargo.iron = 42;
    s.player.cargo.copper = 16;
  });
  const cargoBefore = await page.evaluate(() => window.__cinder!.sim.state.player.props.cargoCapacity);

  // 1. crafting a cargo space
  await page.keyboard.press('Digit3');
  await page.getByTestId('recipe-cargo:1').click();
  await expect(page.getByTestId('craft-detail')).toContainText('Nákladný priestor');
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/m2b-crafting.png' });
  await page.getByTestId('craft').click();
  await page.waitForFunction(() => {
    const s = window.__cinder!.sim.state;
    return (s.stations.get('home')?.parts['cargo:1'] ?? 0) === 1;
  });
  await expect(page.getByTestId('craft-in-storage')).toHaveText('1');
  await expect(page.getByTestId('toast')).toContainText('Vyrobené');
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(1500 - 900);

  // 2. parts market (screenshot)
  await page.keyboard.press('Digit2');
  await page.getByRole('button', { name: 'Diely', exact: true }).click();
  await expect(page.getByTestId('part-cargo:1')).toContainText('1');
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/m2b-market-parts.png' });

  // 3. shipyard: pick a part, ghost over a cell, place with the left button
  // the dot connectors are counted with the hull shell off (SL2 E1: with it on, only the corner hubs of
  // T / L seam junctions remain – covered by the hull shell specs)
  await page.evaluate(async () => {
    const setting = '/src/render/hull/setting.ts';
    ((await import(/* @vite-ignore */ setting)) as typeof import('../../src/render/hull/setting')).setHullShellEnabled(false);
  });
  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await waitTicks(page, 20);
  const joints0 = await connectors(page);
  expect(joints0).toBeGreaterThan(10);
  await page.getByTestId('palette-cargo').click();
  await expect(page.getByTestId('palette-cargo')).toHaveAttribute('aria-pressed', 'true');
  // occupied cell → red ghost with a label
  await hoverCell(page, 0, 0);
  await expect(page.getByTestId('ghost-reason')).toHaveText('Bunka je obsadená');
  await hoverCell(page, 1, 2);
  await expect(page.getByTestId('ghost-reason')).toBeHidden();
  await waitTicks(page, 5);
  await page.screenshot({ path: 'test-results/m2b-shipyard-ghost.png' });
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => draftParts(page)).toBe(15);
  // hull couplings changed live: 2 edges + 1 corner at (1, 2)
  await expect.poll(() => connectors(page)).toBe(joints0 + 3);
  await expect(page.getByTestId('yard-cost')).toContainText('1× Nákladný priestor T1');
  await expect(page.getByTestId('stat-cargo')).toContainText('+60');

  // back and again
  await page.keyboard.press('Control+z');
  await expect.poll(() => draftParts(page)).toBe(14);
  await expect.poll(() => connectors(page)).toBe(joints0);
  await page.keyboard.press('Control+y');
  await expect.poll(() => draftParts(page)).toBe(15);
  await page.keyboard.press('Escape'); // cancels the part selection
  await page.mouse.move(640, 300);
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/m2b-shipyard.png' });

  // 4. confirmation with the Enter key
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.grid.parts.length === 15);
  await expect(page.getByTestId('toast')).toContainText('Loď prestavaná');
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(600 - 10);
  await expect(page.getByTestId('yard-commit')).toHaveAttribute('aria-disabled', 'true');

  // 5. departure – the ship is bigger
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  const after = await page.evaluate(() => window.__cinder!.sim.state.player.props.cargoCapacity);
  expect(after).toBe(cargoBefore + 60);
  await waitTicks(page, 90);
  await page.screenshot({ path: 'test-results/m2b-flight-bigger.png' });
  expect(errors).toEqual([]);
});

test('M2b: editor drag, erase, disconnected parts, leave confirmation and no GPU leaks', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await start(page);
  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await waitTicks(page, 20);
  const mem0 = await page.evaluate(() => window.__cinder!.renderer.memoryInfo());

  // right button removes the radar and the tank → check, highlight of the disconnected engine
  for (const [x, y] of [
    [1, -1],
    [1, 1],
    [2, 0],
  ] as const) {
    const p = await cellPoint(page, x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
  }
  await expect.poll(() => draftParts(page)).toBe(11);
  const check = page.getByTestId('yard-check');
  await expect(check).toContainText('nie sú spojené s kokpitom');
  await expect(page.getByTestId('yard-commit')).toHaveAttribute('aria-disabled', 'true');
  await check.getByRole('button').first().click();
  await page.mouse.move(640, 200);
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/m2b-shipyard-errors.png' });

  // dragging: moving the engine to a free spot (one step back)
  await page.getByTestId('yard-restore').click();
  await expect.poll(() => draftParts(page)).toBe(14);
  await waitTicks(page, 10);
  const from = await cellPoint(page, 0, 2);
  const to = await cellPoint(page, -1, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  const moved = await page.evaluate(() =>
    (window.__cinder!.game as unknown as { yard: { draft: { grid: { parts: { x: number; y: number; partId: string }[] } } } }).yard.draft.grid.parts.some(
      (p) => p.partId === 'engine' && p.x === -1 && p.y === 2,
    ),
  );
  expect(moved).toBe(true);

  // repeated ship rebuilds in the hangar do not leak GPU resources
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
  }
  await waitTicks(page, 10);
  const mem1 = await page.evaluate(() => window.__cinder!.renderer.memoryInfo());
  expect(mem1.geometries).toBeLessThanOrEqual(mem0.geometries + 8);
  expect(mem1.textures).toBeLessThanOrEqual(mem0.textures + 2);

  // departure with an unconfirmed draft → dialog; Back stays in the dock
  await page.keyboard.press('KeyF');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Odletieť bez potvrdenia?');
  await page.screenshot({ path: 'test-results/m2b-shipyard-leave.png' });
  await dialog.getByRole('button', { name: /Späť k návrhu/ }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.dock.mode)).toBe('docked');
  // Esc without a selection → cancel the edits (dialog) → confirm → overview, draft discarded
  await page.mouse.move(640, 300);
  await page.keyboard.press('Escape');
  await expect(dialog).toContainText('Zrušiť úpravy lode?');
  await dialog.getByRole('button', { name: /Zahodiť úpravy/ }).click();
  await expect(page.getByTestId('tab-overview')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.grid.parts.length)).toBe(14);
  expect(errors).toEqual([]);
});

test('M2b: repairs in the service tab', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await start(page);
  // damage through a dev command (engine 40 % → 72 cr + 4 Fe by formula 6.5)
  await page.evaluate(() => {
    const { sim, game } = window.__cinder!;
    const engine = sim.state.player.grid.parts.find((p) => p.partId === 'engine')!;
    game.sendAction({ type: 'debugDamage', partId: engine.id, hp: 10 });
    sim.state.credits = 500;
  });
  await page.keyboard.press('Digit5');
  await expect(page.getByTestId('repairs')).toBeVisible();
  const row = page.locator('[data-testid^="repair-row-"]').first();
  await expect(row).toContainText('72 kr + 4 Fe');
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/m2b-service-repairs.png' });
  await page.getByTestId('repair-all').click();
  await expect(page.getByTestId('repairs-ok')).toBeVisible();
  await expect(page.getByTestId('toast')).toContainText('Opravené');
  expect(errors).toEqual([]);
});
