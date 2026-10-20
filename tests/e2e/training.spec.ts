import { expect, test } from './test';
import type { Page } from '@playwright/test';

// M3.7 Guild Training: a new game from the menu with the training, played through with the real
// keyboard and mouse – the flight by a small autopilot that only presses keys, the station and the
// shipyard by following what the step panel highlights – and a new game that skips it.
// Screenshots: test-results-m37-shots/m37-*.png

// screenshots outside the --output folder (Playwright empties that one at every run)
const OUT = 'test-results-m37-shots';

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

async function newGame(page: Page, skip: boolean, seed = 'vycvik-1337'): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('new-game')).toBeVisible();
  await page.getByTestId('preset-standard').click();
  await page.getByTestId('seed-input').fill(seed);
  const training = page.getByTestId('ng-training');
  await expect(training).toBeVisible();
  await training.getByRole('button', { name: skip ? 'Preskočiť výcvik' : 'Hrať výcvik' }).click();
  await expect(page.getByTestId('ng-training-hint')).toContainText(skip ? 'bez výcviku' : 'krok po kroku');
  await page.screenshot({ path: `${OUT}/m37-00-new-game-${skip ? 'skip' : 'play'}.png` });
  await page.getByTestId('new-game-start').click();
  // creating the game writes the first save and builds the scene – slow under a loaded software renderer
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 120_000 });
}

interface Snap {
  tick: number;
  step: string | null;
  status: string;
  mode: string;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  angle: number;
  angVel: number;
  /** Angular acceleration of the gyroscopes (rad/s²). */
  alpha: number;
  sites: { buoyA: { x: number; y: number }; buoyB: { x: number; y: number }; rock: string; rockPos: { x: number; y: number } } | null;
}

/** A page call that fails instead of hanging when the page stops answering. */
function bounded<T>(p: Promise<T>, what: string, ms = 90_000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer from the page: ${what}`)), ms))]);
}

async function snap(page: Page): Promise<Snap> {
  return bounded(page.evaluate(async () => {
    const { sim } = window.__cinder!;
    const s = sim.state;
    const t = s.career.training;
    const ids = ['flyBuoy', 'mineIron', 'dockSell', 'installSide', 'brakeBuoy', 'installReverse', 'craftCargo', 'checklist', 'finishShip'];
    return {
      tick: s.tick,
      step: t.status === 'active' ? (ids[t.step] ?? null) : null,
      status: t.status,
      mode: s.player.dock.mode,
      pos: { ...s.player.body.pos },
      vel: { ...s.player.body.vel },
      angle: s.player.body.angle,
      angVel: s.player.body.angVel,
      alpha: s.player.props.torque / s.player.props.inertia,
      sites: t.sites,
    };
  }), 'snapshot');
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Keys currently held by the autopilot. */
const held = new Set<string>();
async function hold(page: Page, keys: readonly string[]): Promise<void> {
  for (const k of [...held]) {
    if (!keys.includes(k)) {
      await page.keyboard.up(k);
      held.delete(k);
    }
  }
  for (const k of keys) {
    if (!held.has(k)) {
      await page.keyboard.down(k);
      held.add(k);
    }
  }
}

/** A/D towards `heading`: spin no faster than the gyroscopes can stop in the angle left. */
function turnKeys(s: Snap, heading: number): string[] {
  const e = wrap(heading - s.angle);
  // the frame rate in software WebGL is low: a key may stay down for 15 ticks – stay well inside the limits
  const want = Math.sign(e) * Math.min(1.0, Math.sqrt(2 * s.alpha * 0.45 * Math.abs(e)));
  if (s.angVel < want - 0.08) return ['KeyA'];
  if (s.angVel > want + 0.08) return ['KeyD'];
  return [];
}

/**
 * One autopilot decision with the dampers on, flown the way the training teaches: push along the
 * error to the velocity that leads to `target` (when stopping: slow to a crawl over the last units) –
 * W with the bow along the push, or S (the reverse engine) with the bow against it, whichever keeps
 * the bow towards the target (by the target: whichever needs the smaller turn). With no key down the dampers brake along the bow; a sideways drift
 * (no side engines yet) is corrected by turning the push.
 */
function decide(s: Snap, target: { x: number; y: number }, stop: boolean, cruise: number): string[] {
  const dx = target.x - s.pos.x;
  const dy = target.y - s.pos.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  // stopping: slow to a crawl over the last few units (the brake step wants < 1.5 u/s); the crawl is
  // fast enough to need a push – with the dampers on the ship would otherwise stand still short of it
  const vmax = stop ? Math.min(cruise, 0.3 * Math.max(0, dist - 3) + 0.5) : cruise;
  const ex = (dx / dist) * vmax - s.vel.x;
  const ey = (dy / dist) * vmax - s.vel.y;
  const err = Math.hypot(ex, ey);
  if (err < 0.3) return turnKeys(s, s.angle);
  const push = Math.atan2(ey, ex);
  // the bow towards the target – right by it the bearing swings around, so there the end that needs
  // the smaller turn pushes (no spinning on the spot)
  const reverse = dist < 4 ? Math.abs(wrap(push - s.angle)) > Math.PI / 2 : Math.abs(wrap(push - Math.atan2(dy, dx))) > 0.6 * Math.PI;
  const heading = reverse ? push + Math.PI : push;
  return [...turnKeys(s, heading), ...(Math.abs(wrap(heading - s.angle)) < 0.25 && err > 0.45 ? [reverse ? 'KeyS' : 'KeyW'] : [])];
}

/** Flies with the keyboard until `done` holds (checked on every decision). */
async function flyTo(page: Page, target: () => { x: number; y: number }, opts: { stop: boolean; cruise?: number; done: (s: Snap) => boolean; maxSeconds?: number }): Promise<Snap> {
  let s = await snap(page);
  // game time, not wall time (software WebGL runs the game slower than real time)
  const until = s.tick + (opts.maxSeconds ?? 180) * 60;
  while (!opts.done(s)) {
    if (s.tick > until) throw new Error(`autopilot timeout at ${JSON.stringify(s)}`);
    await hold(page, decide(s, target(), opts.stop, opts.cruise ?? 14));
    await waitTicks(page, 3);
    s = await snap(page);
  }
  await hold(page, []);
  return s;
}

const near = (s: Snap, p: { x: number; y: number }, r: number) => Math.hypot(s.pos.x - p.x, s.pos.y - p.y) <= r;
const speedOf = (s: Snap) => Math.hypot(s.vel.x, s.vel.y);

/** The home station's dock: the docking point by the clamp (the docked ship's centre), the dock axis
 *  pointing out of the port and the docked heading (the bow at the station). */
interface Dock {
  point: { x: number; y: number };
  out: { x: number; y: number };
  heading: number;
}
async function homeDock(page: Page): Promise<Dock> {
  return page.evaluate(async (modules) => {
    const { dockHeading, dockPoint } = (await import(/* @vite-ignore */ modules.dock)) as typeof import('../../src/sim/station/dock');
    const { homeStation } = (await import(/* @vite-ignore */ modules.stations)) as typeof import('../../src/sim/world/stations');
    const st = homeStation();
    return {
      point: dockPoint(st, window.__cinder!.sim.state.player.props.boundingRadius),
      out: { x: Math.cos(st.portAngle), y: Math.sin(st.portAngle) },
      heading: dockHeading(st),
    };
  }, { dock: '/src/sim/station/dock.ts', stations: '/src/sim/world/stations.ts' });
}

/** Distance of the staging point out on the dock axis (u), as the balance bot's creepDock. */
const DOCK_STAGING = 9;

/** Where the ship is relative to the dock axis: `along` out from the docking point, `side` off the axis. */
function axisOffset(s: Snap, dock: Dock): { along: number; side: number; dist: number } {
  const rx = s.pos.x - dock.point.x;
  const ry = s.pos.y - dock.point.y;
  return { along: rx * dock.out.x + ry * dock.out.y, side: -rx * dock.out.y + ry * dock.out.x, dist: Math.hypot(rx, ry) };
}

/** A trace of the last docking decisions (once a game second), printed when the approach fails. */
const dockTrace: string[] = [];
function traceDock(s: Snap, dock: Dock, keys: readonly string[]): void {
  if (dockTrace.length > 0 && s.tick - Number(dockTrace[dockTrace.length - 1]!.split(' ')[0]) < 60) return;
  const a = axisOffset(s, dock);
  const f = (n: number) => n.toFixed(2);
  dockTrace.push(`${s.tick} along=${f(a.along)} side=${f(a.side)} v=(${f(s.vel.x)},${f(s.vel.y)}) bow=${f(wrap(s.angle - dock.heading))} keys=${keys.join('+')}`);
  if (dockTrace.length > 40) dockTrace.shift();
}

/** Z until the dampers are `on` (the key toggles them). */
async function setDampers(page: Page, on: boolean): Promise<void> {
  if ((await page.evaluate(() => window.__cinder!.sim.state.player.dampers)) === on) return;
  await page.keyboard.press('KeyZ');
  await page.waitForFunction((v) => window.__cinder!.sim.state.player.dampers === v, on, { timeout: 30_000 });
}

/**
 * The final approach to the dock clamp the way a pilot flies it with the dampers on: the bow held at
 * the station, W / S along the dock axis and Q / E sideways – the training hull has no side engines,
 * but the cockpit's manoeuvring thrusters (RCS) push it sideways slowly and the dampers stop any drift
 * the moment a key is released, so the ship no longer circles the clamp. It matches the velocity that
 * leads to the docking point (slowing to a crawl by the clamp) and presses F as soon as the ship is
 * inside the game's rules (≤ 4 u, ≤ 3 u/s, bow ±35°) with a margin. Returns false when the approach
 * is lost.
 */
async function creepToClamp(page: Page, dock: Dock, maxSeconds = 120): Promise<boolean> {
  await setDampers(page, true);
  const staging = { x: dock.point.x + dock.out.x * DOCK_STAGING, y: dock.point.y + dock.out.y * DOCK_STAGING };
  let s = await snap(page);
  const until = s.tick + maxSeconds * 60;
  while (s.mode === 'flying') {
    const { along, dist } = axisOffset(s, dock);
    if (s.tick > until || dist > 25 || along < -3) {
      await hold(page, []);
      return false;
    }
    const speed = speedOf(s);
    if (dist <= 3.3 && speed <= 2.4 && Math.abs(wrap(dock.heading - s.angle)) <= 0.45) {
      // inside the docking rules with a margin: request the dock (the latch takes over)
      await hold(page, []);
      await page.keyboard.press('KeyF');
      await waitTicks(page, 6);
      s = await snap(page);
      continue;
    }
    // beside or behind the clamp: out to the staging point on the axis first
    const target = along > 3 || dist < 6 ? dock.point : staging;
    const tx = target.x - s.pos.x;
    const ty = target.y - s.pos.y;
    const dn = Math.max(Math.hypot(tx, ty), 1e-6);
    const vmax = Math.min(2, 0.25 * dn + 0.15);
    // the velocity error in the ship frame (x along the bow, y to the left)
    const ex = (tx / dn) * vmax - s.vel.x;
    const ey = (ty / dn) * vmax - s.vel.y;
    const c = Math.cos(s.angle);
    const sn = Math.sin(s.angle);
    const fwd = ex * c + ey * sn;
    const left = -ex * sn + ey * c;
    const keys = turnKeys(s, dock.heading);
    // a key only for a clear error: with none down the dampers hold the velocity at zero on that axis
    if (fwd > 0.35) keys.push('KeyW');
    else if (fwd < -0.35) keys.push('KeyS');
    if (left > 0.3) keys.push('KeyQ');
    else if (left < -0.3) keys.push('KeyE');
    traceDock(s, dock, keys);
    await hold(page, keys);
    await waitTicks(page, 3);
    s = await snap(page);
  }
  await hold(page, []);
  return true;
}

/**
 * The docking manoeuvre the training teaches: fly towards a staging point out on the dock axis, creep
 * in to the clamp with the dampers on and the bow at the station (home: heading π) and press F there
 * (≤ 4 u from the docking point, ≤ 3 u/s, bow within ±35°). A lost approach starts over.
 */
async function dockHome(page: Page): Promise<void> {
  await small(page);
  const dock = await homeDock(page);
  dockTrace.length = 0;
  const staging = { x: dock.point.x + dock.out.x * DOCK_STAGING, y: dock.point.y + dock.out.y * DOCK_STAGING };
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = await snap(page);
    if (s.mode !== 'flying') break;
    const a = axisOffset(s, dock);
    // already in front of the clamp and slow: straight to the creep (the flight below only has to get
    // roughly there)
    const close = a.along > 1 && a.dist < 16 && speedOf(s) < 3;
    const t0 = s.tick;
    const reached = close ? s : await flyTo(page, () => staging, { stop: true, cruise: 16, done: (x) => near(x, staging, 8) && speedOf(x) < 3 });
    const ok = await creepToClamp(page, dock);
    const t1 = (await snap(page)).tick;
    console.log(`dockHome attempt ${attempt + 1}: staging ${((reached.tick - t0) / 60).toFixed(1)} s, creep ${((t1 - reached.tick) / 60).toFixed(1)} s, ${ok ? 'docking' : 'lost'}`);
    if (ok) break;
  }
  const s = await snap(page);
  if (s.mode === 'flying') throw new Error(`docking approach failed at ${JSON.stringify(s)}\n${dockTrace.join('\n')}`);
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'docked', null, { timeout: 60_000 });
  await full(page);
  await expect(page.getByTestId('station-hub')).toBeVisible();
}

async function stepIs(page: Page, id: string | null): Promise<void> {
  await expect.poll(async () => (await snap(page)).step, { timeout: 20_000 }).toBe(id);
}

const FULL = { width: 1280, height: 720 };
/**
 * Software WebGL renders 1280×720 at a few frames a second, which slows the game itself (the fixed
 * loop catches up at most 0.25 s per frame): the long flights run in a tiny window, the station UI
 * and every screenshot at full size.
 */
async function small(page: Page): Promise<void> {
  await page.setViewportSize({ width: 320, height: 180 });
}
async function full(page: Page): Promise<void> {
  const v = page.viewportSize();
  if (v?.width !== FULL.width) await page.setViewportSize(FULL);
}

/** Undock with the hub button (no-op when the ship already flies). */
async function undockIfDocked(page: Page): Promise<void> {
  if ((await snap(page)).mode === 'docked') await page.getByTestId('undock').click({ timeout: 20_000 });
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', null, { timeout: 30_000 });
  // undocking switches the dampers on; the autopilot flies with them (see decide)
  if (!(await page.evaluate(() => window.__cinder!.sim.state.player.dampers))) {
    await page.keyboard.press('KeyZ');
    await page.waitForFunction(() => window.__cinder!.sim.state.player.dampers, null, { timeout: 30_000 });
  }
}

/** The selector the step panel highlights right now (null = none; never waits for one to appear). */
async function highlightTarget(page: Page): Promise<string | null> {
  const hl = page.getByTestId('training-highlight');
  return (await hl.count()) > 0 ? hl.first().getAttribute('data-target', { timeout: 5_000 }).catch(() => null) : null;
}

/** Screenshot at full size after the UI settled (the window size is restored afterwards). */
async function shot(page: Page, name: string): Promise<void> {
  const before = page.viewportSize();
  await full(page);
  await waitTicks(page, 8);
  await page.screenshot({ path: `${OUT}/m37-${name}.png` });
  if (before && before.width !== FULL.width) await page.setViewportSize(before);
}

/**
 * Screenshots at 1920×1080 … 1280×720; in flight the panel (bottom centre from 1360 px wide, else top left) must not
 * overlap the console, the radar, the scanner / K chip group or the prompts.
 */
async function layoutShot(page: Page, name: string, flying: boolean): Promise<void> {
  const before = page.viewportSize();
  for (const [w, h] of [[1920, 1080], [1760, 990], [1600, 900], [1536, 864], [1366, 768], [1280, 720]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await waitTicks(page, 12);
    await page.screenshot({ path: `${OUT}/m37-${name}-${w}.png` });
    if (!flying) continue;
    const panel = (await page.getByTestId('training-panel').boundingBox())!;
    for (const sel of ['.hud-console', '.hud-radar', '.hud-br', '.hud-prompt', '.hud-hint']) {
      if ((await page.locator(sel).count()) === 0) continue;
      const box = await page.locator(sel).first().boundingBox();
      if (!box) continue;
      const overlap = panel.x < box.x + box.width && panel.x + panel.width > box.x && panel.y < box.y + box.height && panel.y + panel.height > box.y;
      expect(overlap, `${sel} overlaps the training panel at ${w}x${h}`).toBe(false);
    }
  }
  if (before) await page.setViewportSize(before);
}

/**
 * Docked: do what the step panel says until the step changes – click the highlighted element, press
 * the key it shows (R rotates, G objectives), click the suggested hangar cell.
 */
async function followGuide(page: Page, from: string, shots: string[] = []): Promise<void> {
  await full(page);
  for (let i = 0; i < 80; i++) {
    const s = await snap(page);
    if (s.step !== from) return;
    await waitTicks(page, 3);
    if (shots.length > 0) await shot(page, shots.shift()!);
    // the step may have finished during the screenshot – never act on the next step's guide here
    if ((await snap(page)).step !== from) return;
    const panel = page.getByTestId('training-panel');
    const keys = (await panel.locator('.tr-lines li:not(.is-done) kbd').allTextContents()).map((k) => k.trim());
    // the R key first (its highlight is the ghost card, not a button)
    if (keys.includes('R')) {
      await page.keyboard.press('KeyR');
      continue;
    }
    const target = await highlightTarget(page);
    if (target && (await page.locator(target).count()) > 0 && !(await page.locator(target).first().isDisabled().catch(() => false))) {
      await page.locator(target).first().click({ timeout: 20_000 });
      continue;
    }
    const cells = page.getByTestId('training-cell');
    if ((await cells.count()) > 0) {
      const box = (await cells.first().boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      continue;
    }
    if (keys.includes('G')) {
      await page.keyboard.press('KeyG');
      await waitTicks(page, 20);
      await page.keyboard.press('KeyG');
      continue;
    }
    if (keys.includes('Enter')) {
      await page.keyboard.press('Enter');
      continue;
    }
  }
  throw new Error(`guide did not finish step ${from}`);
}

test('M3.7: the whole Guild Training through the real UI ends with the starter ship', async ({ page }) => {
  test.setTimeout(2_400_000);
  const errors = collectErrors(page);
  await newGame(page, false);
  const start = await snap(page);
  expect(start.step).toBe('flyBuoy');
  expect(start.status).toBe('active');
  const startTick = start.tick;
  const ticksAt: Record<string, number> = {};
  const mark = async (id: string) => {
    ticksAt[id] = (await snap(page)).tick - startTick;
  };
  await expect(page.getByTestId('training-panel')).toContainText('Doleť k bóji Cechu');
  // the Guild instructor speaks the step on the radio (comms part B); the panel keeps its why text and checklist
  await expect(page.getByTestId('comm-speaker')).toHaveText('Majster Bartoš', { timeout: 20_000 });
  const phases = page.getByTestId('training-phase');
  await expect(phases.first()).toHaveAttribute('data-state', /^(done|current|todo)$/);
  expect(await phases.evaluateAll((els) => els.filter((e) => e.getAttribute('data-state') === 'current').length)).toBe(1);
  await expect(page.locator('.tr-why')).not.toBeEmpty();
  // the training hull: a forward and a reverse engine (S brakes, the dampers work along the bow)
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.props.thrust)).toEqual({ forward: 90, backward: 90, left: 0, right: 0 });
  await expect(page.getByTestId('training-highlight')).toHaveAttribute('data-target', '[data-testid="undock"]');
  await shot(page, '01-docked-start');

  // 1 – fly to the buoy (W, S, A/D; the dampers on)
  await undockIfDocked(page);
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.keyboard.press('KeyK'); // the controls help collapsed – the panel and the labels stay clear
  await shot(page, '02-fly-buoy');
  await expect(page.getByTestId('training-panel')).toContainText('Doleť k bóji Cechu');
  await expect(page.getByTestId('training-panel').locator('.tr-lines li.is-now')).toContainText('Doleť k bóji Cechu');
  // in flight the panel sits at the bottom centre, clear of the console and the radar
  await expect(page.getByTestId('training-distance')).toHaveText(/^\d+ j$/);
  await layoutShot(page, '02-fly-buoy', true);
  await small(page);
  const sites = start.sites!;
  await flyTo(page, () => sites.buoyA, { stop: false, cruise: 12, done: (s) => s.step !== 'flyBuoy' });
  await mark('flyBuoy');
  // the finished step stays on the panel for a moment: all phases done and the Done badge
  await expect(page.getByTestId('training-completed')).toBeVisible({ timeout: 10_000 });
  expect(await page.getByTestId('training-phase').evaluateAll((els) => els.every((e) => e.getAttribute('data-state') === 'done'))).toBe(true);
  await expect(page.getByTestId('training-completed')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('training-title')).toContainText('Vyťaž 20');

  // 2 – mine 20 iron at the training rock (stop in front of it, aim the mouse, hold the right button)
  await stepIs(page, 'mineIron');
  // praise with the reward on the radio instead of the step toast
  await expect(page.locator('[data-speaker="instructor"]')).toContainText('50 kr', { timeout: 20_000 });
  const d = Math.hypot(sites.rockPos.x, sites.rockPos.y);
  const standoff = { x: sites.rockPos.x - (sites.rockPos.x / d) * 10, y: sites.rockPos.y - (sites.rockPos.y / d) * 10 };
  // the dampers (with the cockpit RCS) stop the ship dead where it arrives: close enough for the laser
  await flyTo(page, () => standoff, { stop: true, cruise: 10, done: (s) => near(s, standoff, 3) && speedOf(s) < 2 });
  await shot(page, '03-mine-arrive');
  // mine at full size: in the tiny window the HUD radar may cover the rock and take the click
  await full(page);
  let mouseDown = false;
  for (let i = 0; i < 600; i++) {
    const s = await snap(page);
    if (s.step !== 'mineIron') break;
    const screen = await page.evaluate((p) => window.__cinder!.renderer.worldToScreen(p), sites.rockPos);
    await page.mouse.move(screen.x, screen.y);
    if (!mouseDown) {
      await page.mouse.down({ button: 'right' });
      mouseDown = true;
    }
    // keep the bow on the rock and hold the position (no thrust unless drifting off)
    const keys = turnKeys(s, Math.atan2(sites.rockPos.y - s.pos.y, sites.rockPos.x - s.pos.x));
    if (!near(s, standoff, 4) || speedOf(s) > 2.5) {
      await page.mouse.up({ button: 'right' });
      mouseDown = false;
      await flyTo(page, () => standoff, { stop: true, cruise: 6, done: (x) => near(x, standoff, 3) && speedOf(x) < 2 });
      continue;
    }
    await hold(page, keys);
    if (i === 20) await shot(page, '04-mining');
    await waitTicks(page, 6);
  }
  if (mouseDown) await page.mouse.up({ button: 'right' });
  await hold(page, []);
  await stepIs(page, 'dockSell');
  await mark('mineIron');

  // 3 – dock and sell
  await shot(page, '05-go-dock');
  await layoutShot(page, '05-go-dock', true);
  await dockHome(page);
  await shot(page, '06-docked-sell');
  await layoutShot(page, '06-docked-sell', false);
  await followGuide(page, 'dockSell');
  await mark('dockSell');

  // 4 – side engines in the shipyard, the editor guided step by step
  await stepIs(page, 'installSide');
  await followGuide(page, 'installSide', ['07-side-open-yard', '08-side-pick-engine', '09-side-rotate', '10-side-place', '11-side-second', '12-side-commit']);
  await mark('installSide');
  const side = await page.evaluate(() => window.__cinder!.sim.state.player.props.thrust);
  expect(side.left).toBeGreaterThan(0);
  expect(side.right).toBeGreaterThan(0);

  // 5 – stop at the second buoy
  await stepIs(page, 'brakeBuoy');
  await undockIfDocked(page);
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await shot(page, '13-brake-buoy');
  await small(page);
  await flyTo(page, () => sites.buoyB, { stop: true, cruise: 14, done: (s) => s.step !== 'brakeBuoy' });
  await mark('brakeBuoy');

  // 6 – the second reverse engine
  await stepIs(page, 'installReverse');
  await dockHome(page);
  await followGuide(page, 'installReverse', ['14-reverse-yard']);
  await mark('installReverse');

  // 7 – craft a cargo hold and install it
  await stepIs(page, 'craftCargo');
  await followGuide(page, 'craftCargo', ['15-craft-open', '16-craft-recipe', '17-craft-button']);
  await mark('craftCargo');

  // 8 – refuel, objectives (G), map (M in flight)
  await stepIs(page, 'checklist');
  await full(page);
  await shot(page, '18-checklist');
  for (let i = 0; i < 12; i++) {
    const s = await snap(page);
    if (s.step !== 'checklist' || s.mode === 'flying') break;
    // the panel still shows the finished craft step for a moment (no keys, no highlight): let it pass
    await waitTicks(page, 30);
    await followGuideOnce(page);
  }
  if ((await snap(page)).step === 'checklist') {
    if ((await snap(page)).mode !== 'flying') {
      await undockIfDocked(page);
      await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
    }
    await page.keyboard.press('KeyM');
    await waitTicks(page, 20);
    await shot(page, '19-map');
    await page.keyboard.press('KeyM');
    await expect.poll(async () => (await snap(page)).step, { timeout: 30_000 }).not.toBe('checklist');
  }
  await mark('checklist');

  // 9 – the rest of the ship
  await stepIs(page, 'finishShip');
  await shot(page, '20-finish-fly-home');
  await dockHome(page);
  await followGuide(page, 'finishShip', ['21-finish-yard', '22-finish-pick']);
  await mark('finishShip');

  // done: the starter ship (the player's own layout), the starting storage, the ready card
  await stepIs(page, null);
  const end = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    const keys = s.player.grid.parts.map((p) => `${p.partId}:${p.tier}`).sort();
    return { status: s.career.training.status, keys, loans: s.player.grid.parts.filter((p) => p.loan).length, storage: s.stations.get('home')!.parts, tick: s.tick };
  });
  expect(end.status).toBe('done');
  expect(end.loans).toBe(0);
  expect(end.keys).toEqual(
    ['cargo:1', 'cargo:1', 'cockpit:1', 'engine:1', 'engine:1', 'engine:1', 'engine:1', 'engine:1', 'engine:1', 'fuelTank:1', 'gyro:1', 'miningLaser:1', 'radar:1', 'reactor:1'].sort(),
  );
  expect(end.storage).toEqual({ 'armor:1': 2, 'cannon:1': 1 });
  await expect(page.getByTestId('training-done')).toBeVisible();
  await shot(page, '23-done');
  // the card no longer times out: still there well after the old 14 s
  await waitTicks(page, 16 * 60);
  await expect(page.getByTestId('training-done')).toBeVisible();
  await page.getByTestId('training-done-close').click();
  await expect(page.getByTestId('training-done')).toHaveCount(0);
  // the comm log (L) keeps the instructor's last words (the shipyard editor hides the radio: leave it first)
  await page.getByTestId('tab-overview').click();
  await page.keyboard.press('KeyL');
  await expect(page.getByTestId('comm-log')).toContainText('Majster Bartoš');
  await page.keyboard.press('KeyL');
  const minutes = (end.tick - startTick) / 60 / 60;
  console.log(`M3.7 training: ${minutes.toFixed(1)} game minutes; step end ticks ${JSON.stringify(ticksAt)}`);
  // the panel is gone after the card, objectives take over (take a contract)
  expect(errors).toEqual([]);
});

/** One guided action while docked (checklist). */
async function followGuideOnce(page: Page): Promise<void> {
  const target = await highlightTarget(page);
  const keys = (await page.getByTestId('training-panel').locator('.tr-lines li:not(.is-done) kbd').allTextContents()).map((k) => k.trim());
  if (keys.includes('G')) {
    await page.keyboard.press('KeyG');
    await waitTicks(page, 20);
    await page.screenshot({ path: `${OUT}/m37-18b-objectives.png` });
    await page.keyboard.press('KeyG');
    await waitTicks(page, 10);
    return;
  }
  if (target && (await page.locator(target).count()) > 0) {
    await page.locator(target).first().click({ timeout: 20_000 });
    await waitTicks(page, 10);
  }
}

test('M3.7: "Skip training" starts with the starter ship and remembers the choice', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await newGame(page, true, 'vycvik-skip');
  const s = await page.evaluate(() => {
    const st = window.__cinder!.sim.state;
    return { status: st.career.training.status, parts: st.player.grid.parts.length, storage: st.stations.get('home')!.parts };
  });
  expect(s.status).toBe('skipped');
  expect(s.parts).toBe(14);
  expect(s.storage).toEqual({ 'armor:1': 2, 'cannon:1': 1 });
  await expect(page.getByTestId('training-panel')).toHaveCount(0);
  // the next New Game screen offers the same choice
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  const remembered = await page.evaluate(() => localStorage.getItem('cinderbelt.skipTraining'));
  expect(remembered).toBe('1');
  expect(errors).toEqual([]);
});

test('M3.7: skipping mid-training from the step panel fits the starter ship at the dock', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await newGame(page, false, 'vycvik-mid');
  await expect(page.getByTestId('training-panel')).toBeVisible();
  await page.getByTestId('training-skip').click();
  await expect(page.getByRole('dialog')).toContainText('Preskočiť výcvik?');
  await shot(page, '24-skip-confirm');
  await page.getByRole('dialog').getByRole('button', { name: 'Preskočiť' }).click();
  await page.waitForFunction(() => window.__cinder!.sim.state.career.training.status === 'skipped');
  const s = await page.evaluate(() => {
    const st = window.__cinder!.sim.state;
    return { parts: st.player.grid.parts.length, storage: st.stations.get('home')!.parts };
  });
  expect(s.parts).toBe(14);
  expect(s.storage).toEqual({ 'armor:1': 2, 'cannon:1': 1 });
  await expect(page.getByTestId('training-panel')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toContainText('Výcvik preskočený');
  expect(errors).toEqual([]);
});
