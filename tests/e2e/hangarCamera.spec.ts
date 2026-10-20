import { expect, test } from './test';
import type { Page } from '@playwright/test';

// Shipyard 2.0, section 3: the hangar camera – orbit (Q/E, middle drag, Alt + left drag), tilt
// (PgUp/PgDn, drag up/down), pan (Shift + middle drag, arrows), Home / "Top view" reset – and editing in a
// tilted, orbited view: the part lands in the cell under the pointer.
// SHOTS=<dir> saves the screenshots there (default test-results/).

const SHOTS = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SHOTS ?? 'test-results';

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

interface Pose {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panZ: number;
}

const pose = (page: Page): Promise<Pose> => page.evaluate(() => ({ ...window.__cinder!.renderer.hangar.view.current }));

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Waits until the damped camera has reached its goal. */
async function settle(page: Page): Promise<void> {
  // the game reads a key press in its next frame – only then the goal pose changes
  await frames(page);
  await page.waitForFunction(() => {
    const v = window.__cinder!.renderer.hangar.view;
    return (['yaw', 'pitch', 'zoom', 'panX', 'panZ'] as const).every((k) => v.current[k] === v.goal[k]);
  });
  // one more frame so the UI over the hangar follows the last camera pose
  await frames(page);
}

/** Window pixel over a hangar cell's floor centre. */
const cellPoint = (page: Page, x: number, y: number) =>
  page.evaluate(([cx, cy]) => window.__cinder!.renderer.hangarCellToScreen(cx, cy, -0.37), [x, y] as const);

const hasPartAt = (page: Page, x: number, y: number, partId: string) =>
  page.evaluate(
    ([cx, cy, id]) => {
      const yard = (window.__cinder!.game as unknown as { yard: { draft: { grid: { parts: { partId: string; x: number; y: number }[] } } } }).yard;
      return yard.draft.grid.parts.some((p) => p.partId === id && p.x === cx && p.y === cy);
    },
    [x, y, partId] as const,
  );

test('hangar camera: orbit, tilt, pan, top view, and placing a part in a tilted orbited view', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await page.evaluate(() => {
    const st = window.__cinder!.sim.state.stations.get('home')!;
    st.parts['cargo:1'] = 2;
  });
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await waitTicks(page, 20);
  await settle(page);

  // opens in the default 3/4 view
  const p0 = await pose(page);
  expect(p0.yaw).toBe(0);
  expect(p0.pitch).toBeCloseTo((55 * Math.PI) / 180);
  await page.mouse.move(640, 700);
  await page.screenshot({ path: `${SHOTS}/hangar-cam-default.png` });

  // Home: straight down, bow up
  await page.keyboard.press('Home');
  await settle(page);
  expect((await pose(page)).pitch).toBeCloseTo(Math.PI / 2);
  await page.screenshot({ path: `${SHOTS}/hangar-cam-top.png` });

  // Q held orbits; PgDn held tilts down to the 3/4 range
  await page.keyboard.down('KeyQ');
  await page.waitForFunction(() => window.__cinder!.renderer.hangar.view.goal.yaw > 0.6);
  await page.keyboard.up('KeyQ');
  await page.keyboard.down('PageDown');
  await page.waitForFunction(() => window.__cinder!.renderer.hangar.view.goal.pitch < 0.75);
  await page.keyboard.up('PageDown');
  await settle(page);
  const p1 = await pose(page);
  expect(p1.yaw).toBeGreaterThan(0.6);
  expect(p1.pitch).toBeLessThan(0.75);
  expect(p1.pitch).toBeGreaterThanOrEqual((35 * Math.PI) / 180 - 1e-6);
  await page.screenshot({ path: `${SHOTS}/hangar-cam-orbited.png` });

  // middle drag: horizontal orbits, vertical tilts (down = more from above)
  const view = (await page.getByTestId('yard-view').boundingBox())!;
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx - 120, cy + 20, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await settle(page);
  const p2 = await pose(page);
  expect(p2.yaw).toBeGreaterThan(p1.yaw + 0.5);
  expect(p2.pitch).toBeGreaterThan(p1.pitch);

  // Alt + left drag orbits too (and does not pick a part)
  await page.keyboard.down('Alt');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy - 40, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await settle(page);
  const p3 = await pose(page);
  expect(p3.yaw).toBeLessThan(p2.yaw - 0.2);
  expect(p3.pitch).toBeLessThan(p2.pitch);
  expect(await page.evaluate(() => (window.__cinder!.game as unknown as { yard: { selected: string | null } }).yard.selected)).toBeNull();

  // Shift + middle drag pans; the arrows pan too
  await page.keyboard.down('Shift');
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 80, cy + 30, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.up('Shift');
  await settle(page);
  const p4 = await pose(page);
  expect(Math.hypot(p4.panX - p3.panX, p4.panZ - p3.panZ)).toBeGreaterThan(1);
  expect(p4.yaw).toBeCloseTo(p3.yaw);
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(([x, z]) => {
    const g = window.__cinder!.renderer.hangar.view.goal;
    return Math.hypot(g.panX - x, g.panZ - z) > 1;
  }, [p4.panX, p4.panZ] as const);
  await page.keyboard.up('ArrowUp');
  // C centres the ship again, keeping the orbit and tilt
  await page.keyboard.press('KeyC');
  await settle(page);
  const p5 = await pose(page);
  expect(p5.yaw).toBeCloseTo(p3.yaw);
  expect(p5.pitch).toBeCloseTo(p3.pitch);

  // a tilted, orbited view: tilt low, then place a cargo hold at (1, 2) with the mouse
  await page.keyboard.down('PageDown');
  await page.waitForFunction(() => window.__cinder!.renderer.hangar.view.goal.pitch <= (36 * Math.PI) / 180);
  await page.keyboard.up('PageDown');
  await page.keyboard.down('KeyE');
  await page.waitForFunction(([y]) => window.__cinder!.renderer.hangar.view.goal.yaw < y - 0.3, [p5.yaw] as const);
  await page.keyboard.up('KeyE');
  await settle(page);
  await page.getByTestId('palette-cargo').click();
  const target = await cellPoint(page, 1, 2);
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await expect(page.getByTestId('ghost-reason')).toBeHidden();
  await waitTicks(page, 5);
  await page.screenshot({ path: `${SHOTS}/hangar-cam-placing-tilted.png` });
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => hasPartAt(page, 1, 2, 'cargo')).toBe(true);

  // the camera keeps moving under a still pointer: the ghost follows the cell under it
  const other = await cellPoint(page, -2, -3);
  await page.mouse.move(other.x, other.y, { steps: 3 });
  const hoverBefore = await page.evaluate(() => (window.__cinder!.game as unknown as { yard: { hover: { x: number; y: number } | null } }).yard.hover);
  expect(hoverBefore).toEqual({ x: -2, y: -3 });
  await page.keyboard.down('KeyQ');
  await page.waitForFunction(() => window.__cinder!.renderer.hangar.view.goal.yaw > 1.5);
  await page.keyboard.up('KeyQ');
  await settle(page);
  const hoverAfter = await page.evaluate(() => (window.__cinder!.game as unknown as { yard: { hover: { x: number; y: number } | null } }).yard.hover);
  const picked = await page.evaluate(([x, y]) => window.__cinder!.renderer.hangarCellAt(x, y), [other.x, other.y] as const);
  expect(hoverAfter).toEqual(picked);
  expect(hoverAfter).not.toEqual({ x: -2, y: -3 });

  // the "Top view" button resets the short way round
  await page.getByTestId('yard-top-view').click();
  await settle(page);
  const p6 = await pose(page);
  expect(p6.pitch).toBeCloseTo(Math.PI / 2);
  expect(Math.abs(Math.sin(p6.yaw))).toBeLessThan(1e-6);
  expect(Math.cos(p6.yaw)).toBeCloseTo(1);
  await page.keyboard.press('Escape');
  await page.mouse.move(640, 700);
  await page.screenshot({ path: `${SHOTS}/hangar-cam-top-after.png` });
  expect(errors).toEqual([]);
});

test('hangar camera: Guild Training suggested cells follow a tilted, orbited view and place the part', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  // the "craft a cargo hold and mount it" step over a ship with one cargo hold (and its side engine) less
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    const g = s.player.grid;
    s.player.grid = { ...g, parts: g.parts.filter((p) => !(p.x === 0 && (p.y === 1 || p.y === 2))) };
    s.career.training.status = 'active';
    s.career.training.step = 6;
    s.career.training.sites = { buoyA: { x: 0, y: 0 }, buoyB: { x: 10, y: 0 }, rock: 'none', rockPos: { x: 0, y: 0 } };
    s.stations.get('home')!.parts['cargo:1'] = 2;
  });
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await page.getByTestId('palette-cargo').click();
  await expect(page.getByTestId('training-cell').first()).toBeVisible();
  await page.evaluate(() => Object.assign(window.__cinder!.renderer.hangar.view.goal, { yaw: 0.9, pitch: 0.65 }));
  await settle(page);
  await page.mouse.move(640, 700);
  await page.screenshot({ path: `${SHOTS}/hangar-cam-training-tilted.png` });

  const centres = await page.getByTestId('training-cell').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
  expect(centres.length).toBeGreaterThan(0);
  const occupied = await page.evaluate(() =>
    (window.__cinder!.game as unknown as { yard: { draft: { grid: { parts: { x: number; y: number }[] } } } }).yard.draft.grid.parts.map((p) => `${p.x},${p.y}`),
  );
  const picked: { x: number; y: number }[] = [];
  for (const c of centres) {
    const cell = (await page.evaluate(([x, y]) => window.__cinder!.renderer.hangarCellAt(x, y), [c.x, c.y] as const))!;
    // the box sits on the cell's floor centre, and that is an empty cell (a suggestion, not a part)
    const centre = await cellPoint(page, cell.x, cell.y);
    expect(Math.hypot(centre.x - c.x, centre.y - c.y)).toBeLessThan(2);
    expect(occupied).not.toContain(`${cell.x},${cell.y}`);
    picked.push(cell);
  }
  // clicking the first suggestion mounts the cargo hold right there
  await page.mouse.move(centres[0]!.x, centres[0]!.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => hasPartAt(page, picked[0]!.x, picked[0]!.y, 'cargo')).toBe(true);
  expect(errors).toEqual([]);
});
