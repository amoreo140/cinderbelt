// M4c "Home and workshop" end to end (T14): the home station's
// Development tab (build, paint, trophies), the on-board workshop in flight (refinery, repair module,
// the large reactor's blast) and the three new parts in the shipyard. Every flow starts from a fixture;
// `window.__cinder` only reads state and runs dev helpers. Screenshots go to `$HOME_SHOTS` (default
// test-results/home) – look at them.
import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { dockAtClamp } from './dockHelper';
import { loadFixture } from './fixtures';

// independent flows – two workers
test.describe.configure({ mode: 'parallel' });

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SHOTS = env.HOME_SHOTS ?? 'test-results/home';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

/** Loose shapes of the renderer internals the checks read (private fields, dev builds only). */
interface Obj3 {
  name: string;
  visible: boolean;
  isMesh?: boolean;
  material?: { userData: Record<string, unknown> } | { userData: Record<string, unknown> }[];
  children: Obj3[];
  traverse(fn: (o: Obj3) => void): void;
}
interface RendererInternals {
  homeModules: { object: Obj3 };
  trophyShelf: { pedestals: { key: string | null }[] };
  shipView: { group: Obj3 };
  hangar: { ship: { group: Obj3 } | null; parked: { object: Obj3 } };
  paintPreview: string | null;
}

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

/** The home modules the renderer shows on the station (by game id). */
function shownModules(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const r = window.__cinder!.renderer as unknown as RendererInternals;
    return r.homeModules.object.children.filter((c) => c.visible).map((c) => c.name.replace('home-module-', '')).sort();
  });
}

/** The paints the meshes of a ship model wear (none = factory): the flown ship, the edited one or the parked ones. */
function paintsOn(page: Page, which: 'ship' | 'hangar' | 'parked'): Promise<string[]> {
  return page.evaluate((which) => {
    const r = window.__cinder!.renderer as unknown as RendererInternals;
    const root = which === 'ship' ? r.shipView.group : which === 'hangar' ? r.hangar.ship?.group : r.hangar.parked.object;
    const out = new Set<string>();
    root?.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const paint = m.userData.afPaint;
        if (typeof paint === 'string') out.add(paint);
      }
    });
    return [...out].sort();
  }, which);
}

/** Builds a module through the Development tab: its row, "Build", the confirmation. */
async function buildModule(page: Page, module: 'paintShop' | 'trophyHall'): Promise<void> {
  await page.getByTestId(`dev-module-${module}`).click();
  await page.getByTestId('dev-build').click();
  await page.locator('[data-modal="confirm"] button').click();
  await expect(page.getByTestId(`dev-module-${module}`)).toHaveAttribute('data-state', 'owned');
}

test('M4c flow 1: Rozvoj on key 8 at home – build the trophy hall and the paint shop, focus views', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'home-dev', { ticks: 30 });
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(25_000);
  await page.keyboard.press('Digit8');
  await expect(page.getByTestId('development')).toBeVisible();
  await expect(page.getByTestId('development')).toContainText('Rozvoj domova');
  await expect(page.getByTestId('dev-module-paintShop')).toHaveAttribute('data-state', 'buyable');
  await expect(page.getByTestId('dev-module-trophyHall')).toHaveAttribute('data-state', 'buyable');
  // the M5 modules are listed, locked
  await expect(page.getByTestId('dev-module-observatory')).toHaveAttribute('data-state', 'future');
  // before the hall the won trophies wait, greyed
  await page.getByTestId('dev-module-trophyHall').click();
  await expect(page.getByTestId('trophies-waiting')).toBeVisible();
  await waitTicks(page, 10);
  await shot(page, 'flow1-rozvoj-sk');

  await buildModule(page, 'trophyHall');
  await buildModule(page, 'paintShop');
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(12_000);
  expect(await page.evaluate(() => [...window.__cinder!.sim.state.home.modules].sort())).toEqual(['paintShop', 'trophyHall']);
  // both modules stand on the station model
  await expect.poll(() => shownModules(page), { timeout: 30_000 }).toEqual(['paintShop', 'trophyHall']);

  // "Show": the dock camera flies to the module, a second press flies back
  await page.getByTestId('dev-show').click();
  await expect.poll(() => page.evaluate(() => window.__cinder!.home!.focus!())).toBe('paintShop');
  await waitTicks(page, 60);
  await page.mouse.move(640, 700);
  await shot(page, 'flow1-focus-paintShop');
  // back to the dock first (picking another row while framed: the test below)
  await page.getByTestId('dev-show').click();
  await expect.poll(() => page.evaluate(() => window.__cinder!.home!.focus!())).toBe(null);
  await page.getByTestId('dev-module-trophyHall').click();
  await page.getByTestId('dev-show').click();
  await expect.poll(() => page.evaluate(() => window.__cinder!.home!.focus!())).toBe('trophyHall');
  await waitTicks(page, 60);
  await page.mouse.move(640, 700);
  await shot(page, 'flow1-focus-trophyHall');
  await page.getByTestId('dev-show').click();
  await expect.poll(() => page.evaluate(() => window.__cinder!.home!.focus!())).toBe(null);
  // leaving the tab ends the focus too
  await page.getByTestId('dev-show').click();
  await page.keyboard.press('Digit1');
  await expect.poll(() => page.evaluate(() => window.__cinder!.home!.focus!())).toBe(null);
  expect(errors).toEqual([]);
});

// Regression (T14): picking another module row while framed used to end the focus from a useEffect in
// <Development>, re-rendering the game UI inside Preact's effect flush ("Hook can only be invoked from
// render methods", two station hubs). HomeUi.select ends it now; the camera returns to the dock, one hub.
test('M4c flow 1: another module row while framed ends the focus', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'home-built', { ticks: 30 });
  await page.keyboard.press('Digit8');
  await page.getByTestId('dev-module-paintShop').click();
  await page.getByTestId('dev-show').click();
  await expect.poll(() => page.evaluate(() => window.__cinder!.home!.focus!())).toBe('paintShop');
  await page.getByTestId('dev-module-trophyHall').click();
  await expect.poll(() => page.evaluate(() => window.__cinder!.home!.focus!())).toBe(null);
  await waitTicks(page, 30);
  await expect(page.getByTestId('station-hub')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('M4c flow 1: key 8 does nothing at another station', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'hour1');
  expect(await page.evaluate(() => (window.__cinder!.sim.state.player.dock as { stationId?: string }).stationId)).not.toBe('home');
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await expect(page.getByTestId('tab-development')).toHaveCount(0);
  await page.keyboard.press('Digit8');
  await waitTicks(page, 10);
  await expect(page.getByTestId('development')).toHaveCount(0);
  expect(await page.evaluate(() => window.__cinder!.home!.data!())).toBeNull();
  expect(errors).toEqual([]);
});

test('M4c flow 2: paint the active and the stored ship – hub, hangar, shipyard hall, switch, flight', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'home-dev', { ticks: 30 });
  await page.evaluate(() => window.__cinder!.home!.build!('paintShop'));
  await page.waitForFunction(() => window.__cinder!.sim.state.home.modules.has('paintShop'));
  await page.keyboard.press('Digit8');
  await page.getByTestId('dev-module-paintShop').click();
  await expect(page.getByTestId('paint-shop')).toBeVisible();
  await expect(page.getByTestId('paint-ship-1')).toHaveAttribute('aria-pressed', 'true');
  expect(await paintsOn(page, 'ship')).toEqual([]);

  // hover previews on the docked ship (render only), the click picks, "Paint" paints
  await page.getByTestId('paint-graphite').hover();
  await expect.poll(() => page.evaluate(() => (window.__cinder!.renderer as unknown as RendererInternals).paintPreview)).toBe('graphite');
  await expect.poll(() => paintsOn(page, 'ship')).toEqual(['graphite']);
  expect(await page.evaluate(() => window.__cinder!.sim.state.fleet.active.paint)).toBeUndefined();
  await waitTicks(page, 20);
  await shot(page, 'flow2-preview-graphite');
  await page.getByTestId('paint-graphite').click();
  await page.mouse.move(640, 700);
  await page.getByTestId('paint-apply').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.fleet.active.paint === 'graphite');
  await expect.poll(() => paintsOn(page, 'ship')).toEqual(['graphite']);
  await expect.poll(() => page.evaluate(() => (window.__cinder!.renderer as unknown as RendererInternals).paintPreview)).toBeNull();

  // the stored "Osa" in the home hangar
  await page.getByTestId('paint-ship-2').click();
  await page.getByTestId('paint-sand').click();
  await page.mouse.move(640, 700);
  await page.getByTestId('paint-apply').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.fleet.stored.find((s) => s.record.id === 2)?.record.paint === 'sand');
  // a preview of the stored ship never paints the docked one
  await expect.poll(() => paintsOn(page, 'ship')).toEqual(['graphite']);

  // hangar cards carry the paint chips
  await page.keyboard.press('Digit1');
  await page.getByTestId('hub-open-hangar').click();
  await expect(page.getByTestId('hangar')).toBeVisible();
  await expect(page.getByTestId('hangar-paint-2')).toHaveAttribute('data-paint', 'sand');
  await expect(page.getByTestId('hangar-paint-1')).toHaveAttribute('data-paint', 'graphite');
  await page.getByTestId('hangar-close').click();

  // the shipyard hall: the edited ship and the parked one in their paints
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('medium'));
  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('yard-ship')).toBeVisible();
  await page.waitForFunction(() => window.__cinder!.renderer.hangar.parkedStats().ships === 1, undefined, { timeout: 60_000 });
  await expect.poll(() => paintsOn(page, 'hangar')).toEqual(['graphite']);
  await expect.poll(() => paintsOn(page, 'parked')).toEqual(['sand']);
  await page.evaluate(() => Object.assign(window.__cinder!.renderer.hangar.view.goal, { pitch: Math.PI / 2, zoom: 0.6 }));
  await waitTicks(page, 60);
  await shot(page, 'flow2-shipyard-hall');

  // switch ships: each keeps its paint
  // digits pick parts in the shipyard: the tab rail
  await page.getByTestId('tab-overview').click();
  await page.getByTestId('hub-open-hangar').click();
  await page.getByTestId('hangar-switch-2').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.fleet.active.id === 2);
  expect(await page.evaluate(() => window.__cinder!.sim.state.fleet.active.paint)).toBe('sand');
  expect(await page.evaluate(() => window.__cinder!.sim.state.fleet.stored.find((s) => s.record.id === 1)?.record.paint)).toBe('graphite');
  await page.getByTestId('hangar-close').click();
  await expect.poll(() => paintsOn(page, 'ship')).toEqual(['sand']);
  await page.keyboard.press('Digit4');
  await expect.poll(() => paintsOn(page, 'hangar')).toEqual(['sand']);
  await expect.poll(() => paintsOn(page, 'parked'), { timeout: 30_000 }).toEqual(['graphite']);

  // in flight
  await page.getByTestId('tab-overview').click();
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', undefined, { timeout: 30_000 });
  await expect.poll(() => paintsOn(page, 'ship')).toEqual(['sand']);
  await waitTicks(page, 90);
  await shot(page, 'flow2-flight-sand');
  expect(errors).toEqual([]);
});

test('M4c flow 3: trophy hall – replicas and the fortress trophy on the pedestals, pin / unpin', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'home-built', { ticks: 30 });
  expect(await page.evaluate(() => window.__cinder!.sim.state.home.trophyPins)).toEqual(['cap:0', 'cap:1', 'fort:1']);
  await page.keyboard.press('Digit8');
  await page.getByTestId('dev-module-trophyHall').click();
  await expect(page.getByTestId('trophy-hall')).toBeVisible();
  await page.getByTestId('dev-show').click();
  await expect.poll(() => page.evaluate(() => window.__cinder!.home!.focus!())).toBe('trophyHall');
  const shelf = () =>
    page.evaluate(() => (window.__cinder!.renderer as unknown as RendererInternals).trophyShelf.pedestals.map((p) => p.key));
  // two captain replicas (clan:level) + the fortress trophy, three pedestals empty
  await expect.poll(shelf, { timeout: 60_000 }).toEqual([expect.stringMatching(/^[a-z]+:\d+$/), expect.stringMatching(/^[a-z]+:\d+$/), 'fortress', null, null, null]);
  const before = await shelf();
  await expect(page.getByTestId('trophy-pedestal-2')).toHaveClass(/dv-pedestal--fortress/);
  await waitTicks(page, 60);
  await page.mouse.move(640, 700);
  await shot(page, 'flow3-trophy-hall-focus');

  // unpin the first captain: pins first, then the unpinned – it moves to the third pedestal
  await page.getByTestId('trophy-pin-cap:0').click();
  await page.waitForFunction(() => !window.__cinder!.sim.state.home.trophyPins.includes('cap:0'));
  await expect(page.getByTestId('trophy-pedestal-2')).toHaveClass(/dv-pedestal--captain/);
  await expect.poll(shelf).toEqual([before[1], 'fortress', before[0], null, null, null]);
  await waitTicks(page, 30);
  await shot(page, 'flow3-trophy-hall-unpinned');
  // pin it back: it goes after the other pins
  await page.getByTestId('trophy-pin-cap:0').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.home.trophyPins.join() === 'cap:1,fort:1,cap:0');
  await expect.poll(shelf).toEqual([before[1], 'fortress', before[0], null, null, null]);
  expect(errors).toEqual([]);
});

test('M4c flow 4: workshop in flight – refinery (fuel, then ore), repair module, refined sale at home', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'workshop', { ticks: 10 });
  const read = () =>
    page.evaluate(() => {
      const p = window.__cinder!.sim.state.player;
      return {
        fuel: p.fuel,
        cap: p.props.fuelCapacity,
        ice: p.cargo.ice,
        iron: p.cargo.iron,
        refined: p.refined.titanium + p.refined.copper + p.refined.iron,
        damaged: [...p.hp.entries()].sort((a, b) => a[0] - b[0]),
      };
    });
  const start = await read();
  expect(start.damaged.length).toBeGreaterThanOrEqual(2);
  expect(start.refined).toBe(0);
  await expect(page.getByTestId('ws-lamp-refinery')).toBeVisible();
  await expect(page.getByTestId('ws-lamp-repair')).toBeVisible();
  // the refinery tops up the tank from ice first
  await waitTicks(page, 300);
  const fuelling = await read();
  expect(fuelling.fuel).toBeGreaterThan(start.fuel);
  expect(fuelling.ice).toBeLessThan(start.ice);
  await expect(page.getByTestId('ws-lamp-refinery')).toHaveClass(/is-fuel/);
  // the repair module heals its neighbours and spends iron (T1 parts)
  await expect(page.getByTestId('ws-lamp-repair')).toHaveClass(/is-working/);
  // the fixture carries 120 iron; the repair bank draws whole units
  expect(fuelling.iron).toBeLessThan(120);
  const healed = fuelling.damaged.some(([id, hp]) => {
    const was = start.damaged.find(([i]) => i === id);
    return was !== undefined && hp > was[1];
  });
  expect(healed || fuelling.damaged.length < start.damaged.length).toBe(true);
  await shot(page, 'flow4-workshop-fuel');

  // a nearly full tank: the refinery goes on to the ore (titanium first)
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.fuel = p.props.fuelCapacity - 0.5;
  });
  await page.waitForFunction(() => window.__cinder!.sim.state.player.refined.titanium >= 1, undefined, { timeout: 60_000 });
  await expect(page.getByTestId('ws-lamp-refinery')).toHaveClass(/is-ore/);
  await expect(page.getByTestId('ws-refined')).toBeVisible();
  await waitTicks(page, 120);
  await shot(page, 'flow4-workshop-ore');

  // home: the market marks the refined titanium and sells it first, with the bonus
  await dockAtClamp(page, { stationId: 'home' });
  await page.keyboard.press('Digit2');
  await expect(page.getByTestId('market-refined-titanium')).toBeVisible();
  const sale = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { credits: s.credits, refined: s.player.refined.titanium, cargo: s.player.cargo.titanium };
  });
  expect(sale.refined).toBeGreaterThanOrEqual(1);
  await page.getByTestId('sell-titanium').hover();
  await expect(page.getByRole('tooltip').or(page.locator('.af-tip')).first()).toContainText('rafinovan', { timeout: 5_000 });
  await shot(page, 'flow4-market-refined');
  await page.getByTestId('sell-titanium').click();
  await page.waitForFunction((c) => window.__cinder!.sim.state.credits > c, sale.credits);
  const after = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { credits: s.credits, refined: s.player.refined.titanium, cargo: s.player.cargo.titanium };
  });
  const sold = sale.cargo - after.cargo;
  expect(sold).toBeGreaterThan(0);
  // refined units leave first
  expect(sale.refined - after.refined).toBeCloseTo(Math.min(sold, sale.refined), 5);
  expect(errors).toEqual([]);
});

test('M4c flow 4: the large reactor blows up – blast event, neighbours lose 40 HP, toast and FX', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'workshop', { ticks: 10 });
  const setup = await page.evaluate(async () => {
    const pb = (await import(/* @vite-ignore */ String('/src/sim/combat/partBlast.ts'))) as typeof import('../../src/sim/combat/partBlast');
    const hpm = (await import(/* @vite-ignore */ String('/src/sim/ship/hp.ts'))) as typeof import('../../src/sim/ship/hp');
    const geo = (await import(/* @vite-ignore */ String('/src/sim/combat/geometry.ts'))) as typeof import('../../src/sim/combat/geometry');
    const grid = (await import(/* @vite-ignore */ String('/src/sim/ship/grid.ts'))) as typeof import('../../src/sim/ship/grid');
    const { sim } = window.__cinder!;
    const p = sim.state.player;
    const reactor = p.grid.parts.find((x) => x.partId === 'largeReactor')!;
    // an empty hold: the large cargo hold goes with the blast and a spill toast would cover the others
    for (const r of ['iron', 'copper', 'titanium', 'ice'] as const) {
      p.cargo[r] = 0;
      if (r !== 'ice') p.refined[r] = 0;
    }
    const neighbours = pb.blastNeighbours(p.grid, reactor).map((id) => {
      const part = p.grid.parts.find((x) => x.id === id)!;
      return { id, hp: hpm.currentHp(p.hp, part) };
    });
    // record the blasts and the parts lost of each step, and every HP write (the blast writes the
    // neighbours' HP before the cut-off pieces leave the ship – most of them leave with the reactor here)
    const rec = { blasts: [] as unknown[], lost: [] as unknown[], writes: [] as [number, number][] };
    (window as unknown as { __rec: typeof rec }).__rec = rec;
    class RecordingMap extends Map<number, number> {
      override set(k: number, v: number): this {
        rec.writes.push([k, v]);
        return super.set(k, v);
      }
    }
    p.hp = new RecordingMap(p.hp);
    const step = sim.step.bind(sim);
    sim.step = (cmd) => {
      const events = step(cmd);
      for (const e of events) {
        if (e.type === 'partBlast') rec.blasts.push(e);
        if (e.type === 'partsLost') rec.lost.push(e);
      }
      return events;
    };
    // a heavy shot straight into the reactor (point blank, through the shield)
    const at = geo.gridToWorld(p.body, p.props.centerOfMass, grid.partCenter(reactor));
    sim.state.combat.projectiles.push({ id: 900_001, owner: 'e2e', pos: at, vel: { x: 1, y: 0 }, ttl: 5, damage: 5_000, tier: 1, origin: { ...at } });
    return { reactor: reactor.id, neighbours };
  });
  expect(setup.neighbours.length).toBeGreaterThan(0);
  await page.waitForFunction(() => (window as unknown as { __rec: { blasts: unknown[] } }).__rec.blasts.length > 0, undefined, { timeout: 10_000 });
  await waitTicks(page, 6);
  await shot(page, 'flow4-blast-fx');
  const rec = await page.evaluate(() => {
    const r = (window as unknown as { __rec: { blasts: { ref: string; partId: number; damage: number }[]; lost: { cause: string }[]; writes: [number, number][] } }).__rec;
    return { ...r, reactorGone: !window.__cinder!.sim.state.player.grid.parts.some((x) => x.partId === 'largeReactor') };
  });
  expect(rec.blasts).toHaveLength(1);
  expect(rec.blasts[0]).toMatchObject({ ref: 'player', partId: setup.reactor, damage: 40 });
  expect(rec.reactorGone).toBe(true);
  expect(rec.lost[0]).toMatchObject({ cause: 'blast' });
  // every neighbour took the 40 HP straight to its hull (the repair module may weld a fraction in between)
  for (const n of setup.neighbours) {
    const want = Math.max(0, n.hp - 40);
    const hit = rec.writes.some(([id, v]) => id === n.id && v >= want - 1e-6 && v < want + 0.5);
    expect(hit, `part ${n.id} (${n.hp} HP)`).toBe(true);
  }
  // the parts-lost toast names the reactor blast as the cause (the hold was emptied: no spill toast on top)
  await expect(page.getByTestId('toast')).toContainText('výbuch reaktora', { timeout: 5_000 });
  await waitTicks(page, 20);
  await shot(page, 'flow4-blast-after');
  expect(errors).toEqual([]);
});

// Regression (T14): the blast toast ("The large reactor exploded – parts around it lost 40 HP") used to
// be replaced at once by the `partsLost` toast of the same step (the reactor itself is always lost) and a
// `cargoSpilled` one. Now one toast (blastToast) says the blast first, then the parts and the cargo.
test('M4c flow 4: the blast toast is shown (merged with the partsLost note of the same step)', async ({ page }) => {
  test.setTimeout(90_000);
  await loadFixture(page, 'workshop', { ticks: 10 });
  await page.evaluate(async () => {
    const geo = (await import(/* @vite-ignore */ String('/src/sim/combat/geometry.ts'))) as typeof import('../../src/sim/combat/geometry');
    const grid = (await import(/* @vite-ignore */ String('/src/sim/ship/grid.ts'))) as typeof import('../../src/sim/ship/grid');
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid="toast"]')?.textContent;
      if (text && seen[seen.length - 1] !== text) seen.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
    const p = window.__cinder!.sim.state.player;
    const reactor = p.grid.parts.find((x) => x.partId === 'largeReactor')!;
    const at = geo.gridToWorld(p.body, p.props.centerOfMass, grid.partCenter(reactor));
    window.__cinder!.sim.state.combat.projectiles.push({ id: 900_002, owner: 'e2e', pos: at, vel: { x: 1, y: 0 }, ttl: 5, damage: 5_000, tier: 1, origin: { ...at } });
  });
  await waitTicks(page, 60);
  expect((await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts)).join(' | ')).toContain('vybuchol');
});

test('M4c flow 5: shipyard – the three parts with icons, the reactor-by-cockpit warning, a plan variant', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'start', { ticks: 10 });
  await page.evaluate(async () => {
    const g = (await import(/* @vite-ignore */ String('/src/sim/ship/grid.ts'))) as typeof import('../../src/sim/ship/grid');
    const pr = (await import(/* @vite-ignore */ String('/src/sim/ship/properties.ts'))) as typeof import('../../src/sim/ship/properties');
    const { sim } = window.__cinder!;
    const p = sim.state.player;
    // the starter ship without the radar (1,-1) and the engine (2,-1): room for a large reactor beside the cockpit
    const grid = g.createGrid([
      ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
      ['fuelTank', 1, 1], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 0, -2, 1], ['engine', 0, 2, 3],
    ]);
    p.grid = grid;
    p.props = pr.computeProperties(grid);
    p.gridVersion++;
    p.hp = new Map();
    p.energy = p.props.batteryCapacity;
    p.fuel = p.props.fuelCapacity;
    // the light armour plan (from fragments) and the parts in the home storage
    sim.state.discovery.plans.add('flywheel');
    const st = sim.state.stations.get('home')!;
    for (const k of ['largeReactor:1', 'repairModule:1', 'refinery:1', 'gyro:1:flywheel'] as const) st.parts[k] = (st.parts[k] ?? 0) + 2;
  });
  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await waitTicks(page, 20);
  for (const key of ['largeReactor', 'repairModule', 'refinery'] as const) {
    const row = page.getByTestId(`palette-${key}`);
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    // the part icon is a real picture
    await expect.poll(() => row.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  // a plan variant (the flywheel gyroscope) shows its stats against the standard part
  const flywheel = page.getByTestId('palette-gyro-flywheel');
  await flywheel.scrollIntoViewIfNeeded();
  await flywheel.click();
  const vs = page.getByTestId('part-variant-vs');
  await expect(vs).toBeVisible();
  await expect(vs.locator('[data-stat="mass"]')).toHaveClass(/is-worse/);
  await expect(vs.locator('.is-better')).not.toHaveCount(0);
  await page.mouse.move(700, 650);
  await waitTicks(page, 10);
  await shot(page, 'flow5-variant-flywheel');

  // the large reactor laid beside the cockpit: KONTROLA warns
  const reactor = page.getByTestId('palette-largeReactor');
  await reactor.scrollIntoViewIfNeeded();
  await reactor.click();
  const at = await page.evaluate(() => window.__cinder!.renderer.hangarCellToScreen(1, -2, -0.37));
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await waitTicks(page, 5);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__cinder!.sim.state.player.grid.parts.length), { timeout: 5_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('yard-check')).toContainText('je hneď pri kokpite', { timeout: 10_000 });
  await page.mouse.move(700, 690);
  await waitTicks(page, 10);
  await shot(page, 'flow5-reactor-warning');
  expect(errors).toEqual([]);
});

test('M4c flow 6: the language switches SK → EN live with Rozvoj open', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'home-built', { ticks: 30 });
  await page.keyboard.press('Digit8');
  await page.getByTestId('dev-module-paintShop').click();
  await expect(page.getByTestId('development')).toContainText('Rozvoj domova');
  await expect(page.getByTestId('paint-apply')).toContainText('Nalakovať');
  await page.evaluate(async () => {
    const { setLocale } = (await import(/* @vite-ignore */ String('/src/i18n/locale.ts'))) as typeof import('../../src/i18n/locale');
    // resolves once the English texts are loaded and switched to
    await setLocale('en');
  });
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page.getByTestId('development')).toContainText('Home development');
  await expect(page.getByTestId('paint-apply')).toContainText('Apply paint');
  await expect(page.getByTestId('dev-module-trophyHall')).toContainText('Trophy hall');
  await expect(page.getByTestId('tab-development')).toContainText('Home');
  await waitTicks(page, 10);
  await shot(page, 'flow6-rozvoj-en');
  expect(errors).toEqual([]);
});
