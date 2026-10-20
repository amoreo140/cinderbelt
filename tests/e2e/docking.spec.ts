import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { approachClamp, dockAtClamp } from './dockHelper';
import { loadFixture } from './fixtures';

// Docking as a manoeuvre: the approach readout and the clamp
// marker, every rejection reason with its toast, the latch, an outpost docking by the same rules and the
// Archive's docking computer relaxing them. Screenshots: test-results-dock-shots/dock-*.png

// screenshots outside the --output folder (Playwright empties that one at every run)
const OUT = 'test-results-dock-shots';

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
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 60_000 });
}

/** Flying by the home dock clamp with the starter ship (the `dock-approach` test save position). */
async function startFlying(page: Page): Promise<void> {
  await loadFixture(page, 'dock-approach', { collapseHelp: false });
}

/** A new game (`?play`), undocked from home – for a spec that flies off elsewhere first. */
async function undockFromHome(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
}

/** The readout items in tolerance, in order: distance, speed, bow. */
async function itemsOk(page: Page): Promise<boolean[]> {
  return Promise.all(['distance', 'speed', 'bow'].map(async (id) => (await page.getByTestId(`dock-item-${id}`).getAttribute('data-ok')) === '1'));
}

const marker = (page: Page) => page.evaluate(() => window.__cinder!.renderer.dockMarkerStats());

/** Hide the UI for a look at the world (the clamp marker). */
async function hideUi(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    document.getElementById('ui')!.style.display = h ? 'none' : '';
  }, hidden);
}

test('docking: approach readout far and close, the clamp marker, the latch', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await startFlying(page);

  // far: out of every tolerance – distance, speed and bow red, the prompt says what to fix first
  await approachClamp(page, { stationId: 'home', offset: 14, side: 3, turn: 1.4, speed: 4.5 });
  await expect(page.getByTestId('dock-approach')).toBeVisible();
  expect(await itemsOk(page)).toEqual([false, false, false]);
  await expect(page.getByTestId('dock-prompt')).toContainText('Prileť k dokovacej svorke');
  expect(await marker(page)).toMatchObject({ visible: true, ready: false, latch: false });
  await page.screenshot({ path: `${OUT}/dock-readout-far.png` });

  // by the clamp but turned away: distance and speed green, bow red
  await approachClamp(page, { stationId: 'home', offset: 2, turn: 1.2 });
  await waitTicks(page, 10);
  expect(await itemsOk(page)).toEqual([true, true, false]);
  await expect(page.getByTestId('dock-prompt')).toContainText('Natoč príď k stanici');
  await page.screenshot({ path: `${OUT}/dock-readout-misaligned.png` });

  // close: all green, the F keycap prompt, the marker turns green
  await approachClamp(page, { stationId: 'home', offset: 2.5, turn: 0.2 });
  await waitTicks(page, 10);
  expect(await itemsOk(page)).toEqual([true, true, true]);
  await expect(page.getByTestId('dock-approach')).toHaveAttribute('data-ready', '1');
  await expect(page.getByTestId('dock-prompt')).toContainText('pristáť na stanici');
  expect(await marker(page)).toMatchObject({ visible: true, ready: true });
  await page.screenshot({ path: `${OUT}/dock-readout-close.png` });

  // the clamp marker in the world (UI hidden): far (glow) and ready (green)
  await hideUi(page, true);
  await page.screenshot({ path: `${OUT}/dock-marker-ready.png` });
  await approachClamp(page, { stationId: 'home', offset: 9, side: 2, turn: 0.9 });
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/dock-marker-approach.png` });
  await hideUi(page, false);

  // the latch: F → the ring closes on the target, the ship is pulled into the dock pose in about a second
  await approachClamp(page, { stationId: 'home', offset: 3, side: 1, turn: -0.3 });
  await expect(page.getByTestId('dock-approach')).toHaveAttribute('data-ready', '1');
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'docking');
  await page.screenshot({ path: `${OUT}/dock-latch.png` });
  expect((await marker(page)).latch || (await page.evaluate(() => window.__cinder!.sim.state.player.dock.mode)) !== 'docking').toBe(true);
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'docked');
  await expect(page.getByTestId('station-hub')).toBeVisible();
  expect(errors).toEqual([]);
});

test('docking: traffic control answers every rejection reason on the radio', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await startFlying(page);
  // the station's traffic control says no; the reason is the message's note (it was a toast before)
  const toast = page.getByTestId('comm-text');

  // too far from the clamp (also: the old "anywhere 12 u from the hull" no longer docks)
  await approachClamp(page, { stationId: 'home', offset: 7 });
  await page.keyboard.press('KeyF');
  await expect(toast).toContainText('Príliš ďaleko od dokovacej svorky');
  await expect(toast).toContainText('treba do 4 j');
  await waitTicks(page, 20);
  await page.screenshot({ path: `${OUT}/dock-reject-too-far.png` });
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.dock.mode)).toBe('flying');

  // too fast
  await approachClamp(page, { stationId: 'home', offset: 3.5, speed: 4.5 });
  await page.keyboard.press('KeyF');
  await expect(toast).toContainText('Príliš rýchlo na pristátie');
  await expect(toast).toContainText('treba do 3 j/s');
  await waitTicks(page, 20);
  await page.screenshot({ path: `${OUT}/dock-reject-too-fast.png` });

  // bow away from the station
  await approachClamp(page, { stationId: 'home', offset: 2, turn: 1.3 });
  await page.keyboard.press('KeyF');
  await expect(toast).toContainText('Príď nemieri k stanici');
  await expect(toast).toContainText('treba do 35°');
  await waitTicks(page, 20);
  await page.screenshot({ path: `${OUT}/dock-reject-misaligned.png` });
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.dock.mode)).toBe('flying');
  expect(errors).toEqual([]);
});

test('docking: an outpost docks by its own clamp under the same rules', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await undockFromHome(page);
  const outpost = await page.evaluate(async (path) => {
    const st = (await import(/* @vite-ignore */ path)) as typeof import('../../src/sim/world/stations');
    const { sim } = window.__cinder!;
    const all = st.stationsInArea(sim.state.seed, -8, 8, -8, 8).filter((s) => s.kind === 'outpost');
    all.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));
    const o = all[0]!;
    // fly there (the chunk loads around the ship)
    const body = { pos: { x: o.pos.x + 60, y: o.pos.y }, vel: { x: 0, y: 0 }, angle: Math.PI, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    return o.id;
  }, '/src/sim/world/stations.ts');
  await page.waitForFunction((id) => window.__cinder!.sim.state.world.stations().some((s) => s.id === id), outpost, { timeout: 30_000 });
  // too far is rejected here as well
  await approachClamp(page, { stationId: outpost, offset: 6 });
  await page.keyboard.press('KeyF');
  // the outpost's own traffic control answers on the radio
  await expect(page.getByTestId('comm-text')).toContainText('Príliš ďaleko od dokovacej svorky');
  await expect(page.getByTestId('comm-speaker')).toContainText('Hliadka');
  await approachClamp(page, { stationId: outpost, offset: 2.5, turn: 0.3 });
  await expect(page.getByTestId('dock-approach')).toHaveAttribute('data-ready', '1');
  // the camera catches up with the jump and the outpost model streams in
  await waitTicks(page, 120);
  await page.screenshot({ path: `${OUT}/dock-outpost-approach.png` });
  await page.keyboard.press('KeyF');
  await page.waitForFunction((id) => {
    const d = window.__cinder!.sim.state.player.dock;
    return d.mode === 'docked' && d.stationId === id;
  }, outpost);
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await waitTicks(page, 60);
  await page.screenshot({ path: `${OUT}/dock-outpost-docked.png` });
  expect(errors).toEqual([]);
});

test('docking: the Archive docking computer relaxes the rules', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.discovery.dataTotal = 60;
    s.discovery.dataFund = 60;
    s.credits = 1000;
  });
  await page.keyboard.press('Digit5');
  await expect(page.getByTestId('archive')).toBeVisible();
  const node = page.getByTestId('archive-node-dockingComputer');
  await expect(node).toContainText('Dokovací počítač');
  await node.click();
  await expect(page.getByTestId('archive-detail')).toContainText('do 12 j od dokovacej svorky');
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/dock-archive-node.png` });
  await page.locator('.hub-body').evaluate((el) => el.scrollTo(0, 0));
  await waitTicks(page, 5);
  await page.screenshot({ path: `${OUT}/dock-archive-tree.png` });
  await page.getByTestId('archive-unlock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.discovery.archive.has('dockingComputer'));
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/dock-archive-node-owned.png` });

  // in flight: 10 u out and the bow away from the station still docks – the computer flies it in. Right
  // after undocking the readout is quiet (the ship is leaving); closing in on the clamp brings it back.
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await waitTicks(page, 10);
  await expect(page.getByTestId('dock-approach')).toBeHidden();
  await approachClamp(page, { stationId: 'home', offset: 10, turn: Math.PI, speed: 1.5 });
  await expect(page.getByTestId('dock-approach')).toContainText('Dokovací počítač');
  await expect(page.getByTestId('dock-approach')).toHaveAttribute('data-ready', '1');
  await page.screenshot({ path: `${OUT}/dock-computer-readout.png` });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode !== 'flying');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'docked');
  expect(errors).toEqual([]);
});

test('docking: the readout and the clamp marker stay quiet while the ship departs', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await undockFromHome(page);
  // right after undocking the ship sits on the docking point with its bow away – no red "turn the bow"
  await waitTicks(page, 20);
  await expect(page.getByTestId('dock-approach')).toBeHidden();
  expect(await marker(page)).toMatchObject({ visible: false });
  await page.screenshot({ path: `${OUT}/dock-departing-undocked.png` });
  // flying off with the bow away: still quiet
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => Math.hypot(window.__cinder!.sim.state.player.body.vel.x, window.__cinder!.sim.state.player.body.vel.y) > 2);
  await page.keyboard.up('KeyW');
  await waitTicks(page, 30);
  await expect(page.getByTestId('dock-approach')).toBeHidden();
  expect(await marker(page)).toMatchObject({ visible: false });
  await page.screenshot({ path: `${OUT}/dock-departing-leaving.png` });
  // coming back on the approach (closing in, bow at the station): the readout and the marker are back
  await approachClamp(page, { stationId: 'home', offset: 12, turn: 0.3, speed: 1.5 });
  await expect(page.getByTestId('dock-approach')).toBeVisible();
  expect(await marker(page)).toMatchObject({ visible: true, latch: false });
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/dock-departing-approach.png` });
  expect(errors).toEqual([]);
});

test('docking: the shared helper docks the ship by the clamp', async ({ page }) => {
  test.setTimeout(90_000);
  await startFlying(page);
  await dockAtClamp(page, { stationId: 'home' });
  await expect(page.getByTestId('station-hub')).toBeVisible();
});
