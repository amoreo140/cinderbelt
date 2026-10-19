import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { dockAtClamp } from './dockHelper';
import { loadFixture, type FixtureName } from './fixtures';

// M4d "Guild and trade" (T17): the Guild and the convoys end to end from
// the M4d test save positions (tests/fixtures/saves) – the Guild relay chain (the pinned slip, the repair
// with F, the mining laser, the hold warning, the Rust counterattack, the Guild reinforcement, the sector
// secured), the Guild Watch in a fight (no friendly fire: the player's shots fly through Watch and convoy
// ships), the convoy link and trade (the approach readout, F, rare goods, cargo sale with the refined bonus,
// tanker fuel, F unlinks), the escort contract (deposit, departure, ambush, arrival refund, turn-in), the
// map planner (route, short fuel, notes, layers 7–8, stale marks), save / load mid-link and mid-hold and
// the live SK → EN switch with the trade window open. State is read through `window.__cinder`; the player
// acts with the real keys and mouse; long flights and fights are fast-forwarded with the game's own step
// (`ff`), moves are teleports ("dev tow"). Screenshots (SK and EN, 1280×720) go to `$GUILD_SHOTS` (default:
// the Playwright output folder of the test).

/** Game modules from the Vite server (in the browser). */
const MOD = {
  relaySites: '/src/sim/guild/relaySites.ts',
  relayChain: '/src/sim/guild/relayChain.ts',
  relays: '/src/sim/sites/relays.ts',
  enemies: '/src/sim/combat/enemies.ts',
  schedule: '/src/sim/convoys/schedule.ts',
  link: '/src/sim/convoys/link.ts',
  escort: '/src/sim/convoys/escort.ts',
  serialize: '/src/sim/save/serialize.ts',
  load: '/src/sim/save/load.ts',
} as const;
type Modules = typeof MOD;
type RelaySitesM = typeof import('../../src/sim/guild/relaySites');
type RelaysM = typeof import('../../src/sim/sites/relays');
type EnemiesM = typeof import('../../src/sim/combat/enemies');
type ScheduleM = typeof import('../../src/sim/convoys/schedule');
type LinkM = typeof import('../../src/sim/convoys/link');
type EscortM = typeof import('../../src/sim/convoys/escort');
type SerializeM = typeof import('../../src/sim/save/serialize');
type LoadM = typeof import('../../src/sim/save/load');

type Vec = { x: number; y: number };
/** A recorded sim event (the fields the specs read). */
type Rec = { type: string; tick: number } & Record<string, unknown>;

/** Sim events the recorder keeps (window.__guild). */
const RECORDED = [
  'actionResult',
  'relayCharging',
  'relayPowered',
  'relayRepaired',
  'relayHoldStarted',
  'sectorSecured',
  'watchEngaged',
  'npcHit',
  'npcDestroyed',
  'projectileHit',
  'shotFired',
  'convoyLinked',
  'convoyUnlinked',
  'convoyTraded',
  'linkRejected',
  'escortDeparted',
  'escortStopped',
  'escortAmbush',
  'contractFailed',
  'contractReady',
  'contractCompleted',
  'interactFailed',
];

// the flows are independent (each starts from its own fixture)
test.describe.configure({ mode: 'parallel' });

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** A screenshot of the whole game (1280×720) as guild-<name>.png. */
const shot = (page: Page, name: string) => page.screenshot({ path: `${env.GUILD_SHOTS ?? test.info().outputDir}/guild-${name}.png` });

function trackErrors(page: Page): string[] {
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

async function waitFrames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );
}

/**
 * Records the step's sim events of the kinds above into `window.__guild` (again after a reload: a new sim)
 * and runs `window.__guildPin` before every step (a test pins the player beside a moving ship with it).
 */
async function recordEvents(page: Page): Promise<void> {
  await page.evaluate((types) => {
    const w = window as unknown as { __guild?: Rec[]; __guildSim?: unknown; __guildPin?: (() => void) | null };
    const sim = window.__cinder!.sim;
    w.__guild ??= [];
    if (w.__guildSim === sim) return;
    w.__guildSim = sim;
    const keep = new Set(types);
    const step = sim.step.bind(sim);
    sim.step = (cmd) => {
      w.__guildPin?.();
      const events = step(cmd);
      for (const e of events) if (keep.has(e.type)) w.__guild!.push({ ...(JSON.parse(JSON.stringify(e)) as Rec), tick: sim.state.tick });
      return events;
    };
  }, RECORDED);
}

const recorded = (page: Page, type: string): Promise<Rec[]> =>
  page.evaluate((t) => ((window as unknown as { __guild?: Rec[] }).__guild ?? []).filter((e) => e.type === t), type);

async function waitEvent(page: Page, type: string, match: Record<string, unknown> = {}, timeout = 60_000): Promise<Rec> {
  const handle = await page.waitForFunction(
    ([t, m]) => ((window as unknown as { __guild?: Rec[] }).__guild ?? []).find((e) => e.type === t && Object.entries(m).every(([k, v]) => e[k] === v)) ?? null,
    [type, match] as const,
    { timeout },
  );
  return (await handle.jsonValue()) as Rec;
}

/** The result of the dev / UI action with this reqId. */
async function actionResult(page: Page, reqId: number): Promise<Rec> {
  return waitEvent(page, 'actionResult', { reqId }, 30_000);
}

/**
 * Fast-forward: runs the game's own step (input, sim, radio, toasts) `ticks` times at once – long flights
 * and fights in seconds instead of minutes of SwiftShader frames. Stops early when `until` (a function
 * body over `s` = the sim state) is true.
 */
async function ff(page: Page, ticks: number, until?: string): Promise<number> {
  return page.evaluate(
    ([n, cond]) => {
      const game = window.__cinder!.game as unknown as { stepSimulation(): void };
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const stop = cond ? (new Function('s', `return (${cond});`) as (s: unknown) => boolean) : null;
      for (let i = 0; i < n; i++) {
        if (stop?.(window.__cinder!.sim.state)) return i;
        game.stepSimulation();
      }
      return n;
    },
    [ticks, until ?? null] as const,
  );
}

/** What the radio received so far (speaker + text), oldest first. */
const radio = (page: Page): Promise<{ speaker: string; text: string }[]> =>
  page.evaluate(() =>
    (window.__cinder!.game as unknown as { comms: { queue: { transcript: { speaker: { name: string }; lines: string[]; note?: string }[] } } }).comms.queue.transcript.map((e) => ({
      speaker: e.speaker.name,
      text: [...e.lines, e.note ?? ''].join(' '),
    })),
  );

/** Puts the flying ship at a point (stopped unless `vel` is given), bow at `angle`; chunks load around it. */
async function place(page: Page, pos: Vec, angle: number, vel: Vec = { x: 0, y: 0 }): Promise<void> {
  await page.evaluate(
    ([p, a, v]) => {
      const { sim } = window.__cinder!;
      const body = { pos: { ...p }, vel: { ...v }, angle: a, angVel: 0 };
      sim.state.player.body = body;
      sim.state.player.prevBody = body;
      sim.state.player.dampers = v.x === 0 && v.y === 0;
      sim.state.world.update(body.pos);
    },
    [pos, angle, vel] as const,
  );
}

/** Waits until the follow camera has caught up with the ship (a screen point taken earlier would miss). */
async function settleCamera(page: Page): Promise<void> {
  const shipOnScreen = () => page.evaluate(() => window.__cinder!.renderer.worldToScreen(window.__cinder!.sim.state.player.body.pos));
  let prev = await shipOnScreen();
  for (let i = 0; i < 120; i++) {
    await waitFrames(page, 2);
    const now = await shipOnScreen();
    if (Math.hypot(now.x - prev.x, now.y - prev.y) < 0.5) return;
    prev = now;
  }
}

/** Moves the mouse over a point of the plane (sim coordinates). */
async function aimAt(page: Page, pos: Vec, settle = true): Promise<Vec> {
  if (settle) await settleCamera(page);
  const at = await page.evaluate((p) => window.__cinder!.renderer.worldToScreen(p), pos);
  expect(at.x > 0 && at.x < 1280 && at.y > 0 && at.y < 720, `aim point ${Math.round(at.x)}, ${Math.round(at.y)} on screen`).toBe(true);
  await page.mouse.move(at.x, at.y);
  return at;
}

/** Keeps the battery full and the lasers / guns cool (long beams and salvos must not run dry). */
const keepCharged = (page: Page) =>
  page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.energy = p.props.batteryCapacity;
    p.heat.clear();
  });

/** A fresh, whole ship (a long fast-forwarded fight must not end the spec). */
const repairShip = (page: Page) =>
  page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.hp = new Map();
    p.energy = p.props.batteryCapacity;
    p.heat.clear();
  });

/**
 * Keeps the ship whole at every step (a fast-forwarded fight with nobody at the controls must not end the
 * spec or knock parts off); `pin` also holds it where it is now (rams and hits must not push it into the
 * rocks). `on = false` turns it off.
 */
const shield = (page: Page, on = true, pin = false) =>
  page.evaluate(
    ([v, hold]) => {
      const w = window as unknown as { __guildPin?: (() => void) | null };
      const p0 = window.__cinder!.sim.state.player;
      const at = { pos: { ...p0.body.pos }, angle: p0.body.angle };
      w.__guildPin = v
        ? () => {
            const p = window.__cinder!.sim.state.player;
            if (p.hp.size > 0) p.hp = new Map();
            p.energy = p.props.batteryCapacity;
            if (hold) {
              const body = { pos: { ...at.pos }, vel: { x: 0, y: 0 }, angle: at.angle, angVel: 0 };
              p.body = body;
              p.prevBody = body;
            }
          }
        : null;
    },
    [on, pin] as const,
  );

/** Destroys the enemies whose id starts with `prefix` (as if shot down – `defeated` keeps them away). */
const defeat = (page: Page, prefix: string) =>
  page.evaluate((pre) => {
    const s = window.__cinder!.sim.state;
    for (const e of s.combat.enemies) if (e.id.startsWith(pre)) s.combat.defeated.set(e.id, s.tick);
    s.combat.enemies = s.combat.enemies.filter((e) => !e.id.startsWith(pre));
  }, prefix);

/** Collapses the controls help again (a reload brings it back). */
const quietHelp = (page: Page) =>
  page.evaluate(() => {
    const game = window.__cinder!.game as unknown as { helpOpen: boolean; helpTouched: boolean };
    game.helpOpen = false;
    game.helpTouched = true;
  });

async function start(page: Page, name: FixtureName, params?: Record<string, string>): Promise<string[]> {
  const errors = trackErrors(page);
  await loadFixture(page, name, { ticks: 5, ...(params ? { params } : {}) });
  await recordEvents(page);
  return errors;
}

/** Save → load (migration + validation) → the game restarts from the save. */
async function saveAndLoad(page: Page): Promise<void> {
  await page.evaluate(async (m: Modules) => {
    const S = (await import(/* @vite-ignore */ m.serialize)) as SerializeM;
    const L = (await import(/* @vite-ignore */ m.load)) as LoadM;
    const now = '2026-10-21T12:00:00.000Z';
    const save = S.toSave(window.__cinder!.sim, { gameId: 'e2e-cech', name: 'e2e', createdAt: now, savedAt: now, reason: 'manual', gameVersion: 'e2e' });
    const loaded = L.loadSave(JSON.parse(JSON.stringify(S.toEnvelope(save))));
    if (!loaded.ok) throw new Error(`load: ${loaded.error}`);
    (window as unknown as { __guildOld: unknown }).__guildOld = window.__cinder!.sim;
    (window as unknown as { __cinderApp: { startSimulation(sim: unknown): void } }).__cinderApp.startSimulation(S.restoreSimulation(loaded.save));
  }, MOD);
  await page.waitForFunction(() => !!window.__cinder && window.__cinder.sim !== (window as unknown as { __guildOld: unknown }).__guildOld, undefined, { timeout: 60_000 });
  await waitTicks(page, 5);
  await recordEvents(page);
  await quietHelp(page);
}

// ---------------------------------------------------------------------------
// the Guild relay chain

/** The border layer's placed models by kind (a marker's model is its sector's security). */
const borderModels = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => {
    const layer = (window.__cinder!.renderer as unknown as { borders: { placed: { model: string }[] } }).borders;
    const out: Record<string, number> = {};
    for (const p of layer.placed) out[p.model] = (out[p.model] ?? 0) + 1;
    return out;
  });

/** The lane-A Guild relay site of the fixtures' seed and the receiver lens of its mast. */
async function relaySiteA(page: Page): Promise<{ pos: Vec; angle: number; sector: string; id: string; receiver: Vec; mastRadius: number }> {
  return page.evaluate(async (m: Modules) => {
    const G = (await import(/* @vite-ignore */ m.relaySites)) as RelaySitesM;
    const R = (await import(/* @vite-ignore */ m.relays)) as RelaysM;
    const s = window.__cinder!.sim.state;
    const site = G.guildRelaySite(s.seed, 'A')!;
    return { pos: { ...site.pos }, angle: site.angle, sector: site.sector, id: site.id, receiver: R.receiverPos(site.relay), mastRadius: G.MAST_RADIUS };
  }, MOD);
}

/** The site layer's Guild mast counts (every lane's mast drawn, the broken ones with the overlay). */
const siteStats = (page: Page): Promise<{ guildMasts: number; guildBroken: number }> =>
  page.evaluate(() => {
    const st = (window.__cinder!.renderer as unknown as { sites: { stats(): { guildMasts: number; guildBroken: number } } }).sites.stats();
    return { guildMasts: st.guildMasts, guildBroken: st.guildBroken };
  });

/** Holds the mining laser on the relay's receiver lens until it is powered. */
async function powerRelay(page: Page, receiver: Vec): Promise<void> {
  await keepCharged(page);
  await aimAt(page, receiver);
  await page.mouse.down({ button: 'right' });
  for (let i = 0; i < 60; i++) {
    if ((await recorded(page, 'relayPowered')).some((e) => e.id === 'gr:A')) break;
    await keepCharged(page);
    await aimAt(page, receiver, false);
    await waitTicks(page, 15);
  }
  await page.mouse.up({ button: 'right' });
  await waitEvent(page, 'relayPowered', { id: 'gr:A' }, 30_000);
}

test('Guild relay: the pinned slip, accept, F at the mast repairs it with the cargo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await start(page, 'relay-ready');
  const site = await relaySiteA(page);

  // the station board pins the relay slip (lane A, the sector will be Guarded for good)
  await page.getByTestId('tab-board').click();
  const slip = page.locator('[data-testid$=".relay"]').first();
  await expect(slip).toBeVisible();
  await expect(slip).toContainText('Relé Cechu');
  await slip.scrollIntoViewIfNeeded();
  await page.mouse.move(10, 10);
  await waitTicks(page, 10);
  await shot(page, 'relay-slip-sk');
  const offerId = (await page.locator('[data-testid^="accept-"][data-testid$=".relay"]').getAttribute('data-testid'))!.slice('accept-'.length);
  await page.getByTestId(`accept-${offerId}`).click();
  await page.waitForFunction((id) => window.__cinder!.sim.state.career.contracts.some((c) => c.id === id), offerId);
  const serial = await page.evaluate((id) => window.__cinder!.sim.state.career.contracts.find((c) => c.id === id)!.serial, offerId);

  // undock, the dev tow to the mast (the stand-off of the fixture generator)
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', undefined, { timeout: 30_000 });
  const bR = await page.evaluate(() => window.__cinder!.sim.state.player.props.boundingRadius);
  const out = { x: Math.cos(site.angle), y: Math.sin(site.angle) };
  const reach = site.mastRadius + bR + 2;
  await place(page, { x: site.pos.x + out.x * reach, y: site.pos.y + out.y * reach }, Math.atan2(-out.y, -out.x));
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.combat.enemies = [];
  });
  await waitTicks(page, 30);
  // the Guild chip: stage broken, the hint lists the repair materials
  const chip = page.getByTestId('guild-relay');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-stage', 'broken');
  await expect(chip).toContainText('60');
  await settleCamera(page);
  await page.mouse.move(900, 600);
  await waitFrames(page, 2);
  await shot(page, 'relay-mast-broken-sk');

  // the mast drawn with its broken overlay (render: every lane's mast, the broken ones overlaid)
  await expect.poll(async () => (await siteStats(page)).guildMasts, { timeout: 20_000 }).toBeGreaterThan(0);
  const broken0 = (await siteStats(page)).guildBroken;
  expect(broken0).toBeGreaterThan(0);

  // F repairs it: 60 Fe, 40 Cu, 10 Ti out of the cargo
  await page.keyboard.press('KeyF');
  await waitEvent(page, 'relayRepaired', { lane: 'A' });
  const after = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { cargo: { ...s.player.cargo }, stage: s.guild.relays.get('A')?.stage, mode: s.player.dock.mode };
  });
  expect(after.stage).toBe('repaired');
  expect(after.mode).toBe('flying');
  expect(after.cargo.iron).toBeCloseTo(20, 5);
  expect(after.cargo.copper).toBeCloseTo(10, 5);
  expect(after.cargo.titanium).toBeCloseTo(10, 5);
  await expect(chip).toHaveAttribute('data-stage', 'repaired');
  await expect.poll(async () => (await siteStats(page)).guildBroken, { timeout: 10_000 }).toBe(broken0 - 1);
  expect(await page.evaluate((n) => window.__cinder!.sim.state.career.contracts.find((c) => c.serial === n)!.progress, serial)).toBe(1);
  // the radio: the Watch asks for the laser
  await expect.poll(async () => (await radio(page)).some((r) => r.text.includes('laser')), { timeout: 15_000 }).toBe(true);
  await waitTicks(page, 20);
  await page.mouse.move(900, 600);
  await waitFrames(page, 2);
  await shot(page, 'relay-repaired-sk');
  expect(errors).toEqual([]);
});

test('Guild relay: the laser powers it → the hold warning → the Rust counterattack; save / load mid-hold', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await start(page, 'relay-hold');
  const site = await relaySiteA(page);
  await powerRelay(page, site.receiver);
  const warned = await waitEvent(page, 'relayHoldStarted', { lane: 'A' });
  expect(await page.evaluate(() => window.__cinder!.sim.state.guild.relays.get('A')?.stage)).toBe('powered');
  expect(await page.evaluate(() => window.__cinder!.sim.state.guild.hold?.phase)).toBe('warning');
  await expect(page.getByTestId('guild-relay')).toHaveAttribute('data-stage', 'powered');
  // the warning on the radio: the Rust counterattack, the reinforcement on its way
  await expect.poll(async () => (await radio(page)).some((r) => /Hrdz/.test(r.text)), { timeout: 15_000 }).toBe(true);
  // the mast (render): drawn without the broken overlay
  const masts = await siteStats(page);
  expect(masts.guildMasts).toBeGreaterThan(0);
  expect(masts.guildBroken).toBeLessThan(masts.guildMasts);
  await waitTicks(page, 10);
  await shot(page, 'relay-hold-warning-sk');

  // save / load in the warning: the hold, the stage and the powered mast survive
  await saveAndLoad(page);
  const loaded = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { stage: s.guild.relays.get('A')?.stage, hold: s.guild.hold, powered: s.sites.powered.has('gr:A') };
  });
  expect(loaded.stage).toBe('powered');
  expect(loaded.powered).toBe(true);
  expect(loaded.hold?.lane).toBe('A');
  expect(['warning', 'fight']).toContain(loaded.hold?.phase);

  // the counterattack comes 6 s after the warning, 320 u out
  await repairShip(page);
  await ff(page, 600, `s.combat.enemies.some((e) => e.id.startsWith('rc:A:'))`);
  const party = await page.evaluate(() => window.__cinder!.sim.state.combat.enemies.filter((e) => e.id.startsWith('rc:A:')).map((e) => ({ id: e.id, kind: e.kind, pos: e.body.pos })));
  expect(party.length).toBe(3);
  const at = warned.at as Vec;
  for (const e of party) expect(Math.hypot(e.pos.x - at.x, e.pos.y - at.y)).toBeLessThan(60);
  expect(await page.evaluate(() => window.__cinder!.sim.state.guild.hold?.phase)).toBe('fight');

  // save / load mid-fight: the party ids and the hold come back
  await saveAndLoad(page);
  const again = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { phase: s.guild.hold?.phase, rc: s.combat.enemies.filter((e) => e.id.startsWith('rc:A:')).length };
  });
  expect(again.phase).toBe('fight');
  expect(again.rc).toBeGreaterThan(0);
  await waitTicks(page, 30);
  await page.mouse.move(900, 600);
  await waitFrames(page, 2);
  await shot(page, 'relay-counterattack-sk');
  expect(errors).toEqual([]);
});

test('Guild relay: the reinforcement comes, the hold is won – the sector reads Guarded (badge, card, map, borders, chip, radio)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await start(page, 'relay-fight');
  const site = await relaySiteA(page);
  await expect(page.getByTestId('sector-badge')).toHaveAttribute('data-security', 'contested');
  await expect(page.getByTestId('guild-relay')).toHaveAttribute('data-stage', 'powered');
  const bordersBefore = await borderModels(page);
  await shield(page, true, true);

  // the Guild reinforcement (frigate + 2 cutters) 25 s after the fight began – the ship kept whole meanwhile
  for (let i = 0; i < 12; i++) {
    await repairShip(page);
    if ((await ff(page, 150, `s.guild.watch.some((w) => w.id.startsWith('gw:relay:A'))`)) < 150) break;
  }
  const reinforcement = await page.evaluate(() => window.__cinder!.sim.state.guild.watch.filter((w) => w.id.startsWith('gw:relay:A')).map((w) => w.kind));
  expect(reinforcement.sort()).toEqual(['cutter', 'cutter', 'frigate']);
  await expect.poll(async () => (await radio(page)).some((r) => r.text.includes('Fregata a dva kutre') || r.text.includes('Posily Cechu')), { timeout: 20_000 }).toBe(true);
  // they fly in from 500 u – a few seconds later they are in the fight and drawn as live ships
  await repairShip(page);
  await ff(page, 600, `s.guild.watch.filter((w) => w.id.startsWith('gw:relay:A') && Math.hypot(w.body.pos.x - ${site.pos.x}, w.body.pos.y - ${site.pos.y}) < 250).length >= 2`);
  await repairShip(page);
  await expect.poll(() => page.evaluate(() => window.__cinder!.renderer.visualStats().borders.live), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await page.mouse.move(900, 600);
  await waitTicks(page, 20);
  await shot(page, 'relay-reinforcement-sk');

  // the counterattack is beaten (state edit: the ships destroyed) → the hold is won
  await defeat(page, 'rc:A:');
  await ff(page, 120, `s.guild.relays.get('A')?.stage === 'secured'`);
  const secured = await waitEvent(page, 'sectorSecured', { lane: 'A' });
  expect(secured.sector).toBe(site.sector);
  const after = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    const c = s.career.contracts.find((x) => x.target.kind === 'relay')!;
    return { stage: s.guild.relays.get('A')?.stage, hold: s.guild.hold, ready: c.ready, progress: c.progress };
  });
  expect(after).toEqual({ stage: 'secured', hold: null, ready: true, progress: 3 });
  await expect(page.getByTestId('sector-badge')).toHaveAttribute('data-security', 'guarded', { timeout: 10_000 });
  await expect(page.getByTestId('sector-badge')).toContainText('STRÁŽENÝ', { ignoreCase: true });
  await expect.poll(async () => (await radio(page)).some((r) => r.text.includes('Strážený') || r.text.includes('ochranou Stráže')), { timeout: 20_000 }).toBe(true);
  // the border markers follow the new security (the rebuild key includes the secured sectors)
  // the border markers follow the new security (the rebuild key includes the secured sectors): the
  // Contested markers of the relay sector's edges turn into Guarded ones
  await expect.poll(async () => (await borderModels(page)).guarded ?? 0, { timeout: 20_000 }).toBeGreaterThan(bordersBefore.guarded ?? 0);
  expect((await borderModels(page)).contested ?? 0).toBeLessThan(bordersBefore.contested ?? 0);
  await waitTicks(page, 30);
  await page.mouse.move(900, 600);
  await waitFrames(page, 2);
  await shot(page, 'relay-secured-sk');

  // the map: the sector card of the relay sector says Guarded
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  const box = (await page.getByTestId('map-canvas').boundingBox())!;
  const card = page.getByTestId('sector-card');
  let found = false;
  for (const [dx, dy] of [[0, 0], [-30, 0], [30, 0], [0, 30], [0, -30], [-80, 0], [80, 0]] as const) {
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await page.waitForTimeout(250);
    if ((await card.count()) > 0 && ((await card.textContent()) ?? '').includes('Prázdne pobrežie')) {
      found = true;
      break;
    }
  }
  expect(found, 'the card of the relay sector under the cursor').toBe(true);
  await expect(card).toContainText('Strážený');
  await waitTicks(page, 10);
  await shot(page, 'relay-secured-map-sk');
  await page.keyboard.press('KeyM');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// the Guild Watch

/** Bearing of a target off the bow (rad, to port) inside the hour-2 ship's only open cannon arc (20–60°). */
const GUN_BEARING = (40 * Math.PI) / 180;

test('Guild Watch: the lane patrol engages the pirates in its beat (radio, radar, live ships)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await start(page, 'watch-fight');
  const watch0 = await page.evaluate(() => window.__cinder!.sim.state.guild.watch.map((w) => ({ id: w.id, kind: w.kind, mode: w.mode, hull: w.hull })));
  expect(watch0.filter((w) => w.id.startsWith('gw:lane:')).length).toBeGreaterThanOrEqual(2);
  // the Watch engages: watchEngaged, its target a fixture pirate, its shots hit the pirates
  await shield(page);
  await ff(page, 900, `s.guild.watch.some((w) => w.mode === 'engage')`);
  const engaged = await waitEvent(page, 'watchEngaged');
  expect(String(engaged.target)).toMatch(/^fixture:watch-fight:/);
  await ff(page, 600);
  const hits = (await recorded(page, 'projectileHit')).filter((e) => String(e.owner).startsWith('gw:') && String(e.ref ?? '').startsWith('fixture:watch-fight:'));
  expect(hits.length, 'Watch shots on the pirates').toBeGreaterThan(0);
  // the radio: the Watch speaks (first contact or "Kontakt, zasahujeme.")
  await expect.poll(async () => (await radio(page)).some((r) => r.speaker.includes('Stráž')), { timeout: 20_000 }).toBe(true);
  // live ships on screen: drawn by the border layer as live Watch ships
  await expect.poll(() => page.evaluate(() => window.__cinder!.renderer.visualStats().borders.live), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  // the camera to the fight (a tow 90 u off the engaged Watch ship, held there): the ships, their shots
  const near = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    const w = s.guild.watch.find((x) => x.mode === 'engage') ?? s.guild.watch[0]!;
    const e = s.combat.enemies.find((x) => x.id === w.target) ?? s.combat.enemies[0];
    const away = e ? Math.atan2(w.body.pos.y - e.body.pos.y, w.body.pos.x - e.body.pos.x) : 0;
    return { x: w.body.pos.x + Math.cos(away) * 90, y: w.body.pos.y + Math.sin(away) * 90, a: away + Math.PI };
  });
  await place(page, near, near.a);
  await shield(page, true, true);
  await page.mouse.move(900, 600);
  await waitTicks(page, 40);
  await shot(page, 'watch-fight-sk');
  await shield(page, false);
  await page.locator('.hud-radar').screenshot({ path: `${env.GUILD_SHOTS ?? test.info().outputDir}/guild-watch-radar-sk.png` });
  expect(errors).toEqual([]);
});

test('Guild Watch: it defends the player, and the player\'s shots fly through a Watch ship (no friendly fire)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await start(page, 'secured');
  await expect(page.getByTestId('sector-badge')).toHaveAttribute('data-security', 'guarded');
  const patrol = await page.evaluate(() => window.__cinder!.sim.state.guild.watch.find((w) => w.route.startsWith('sector:'))!.id);

  // the player's shots: pinned 30 u behind the patrol ship, the ship at it in its guns' arc (the hour-2
  // ship's own hull leaves its cannons a 20–60° wedge to port), the guns fire through it
  await page.evaluate(([id, GUN_BEARING]) => {
    const w = window as unknown as { __guildPin?: (() => void) | null; __guildThrough?: number };
    w.__guildThrough = 0;
    w.__guildPin = () => {
      const s = window.__cinder!.sim.state;
      const ship = s.guild.watch.find((x) => x.id === id);
      if (!ship) return;
      const a = ship.body.angle;
      const pos = { x: ship.body.pos.x - Math.cos(a) * 30, y: ship.body.pos.y - Math.sin(a) * 30 };
      const body = { pos, vel: { ...ship.body.vel }, angle: a - GUN_BEARING, angVel: 0 };
      s.player.body = body;
      s.player.prevBody = body;
      s.player.energy = s.player.props.batteryCapacity;
      s.player.heat.clear();
      // a shot just past the hull, still on its line = it flew through the ship
      for (const p of s.combat.projectiles) {
        if (p.owner !== 'player') continue;
        const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
        const dx = p.pos.x - ship.body.pos.x;
        const dy = p.pos.y - ship.body.pos.y;
        const along = (dx * p.vel.x + dy * p.vel.y) / sp;
        const side = Math.abs(dx * p.vel.y - dy * p.vel.x) / sp;
        if (along > 0 && along < 30 && side < 3) w.__guildThrough!++;
      }
    };
  }, [patrol, GUN_BEARING] as const);
  await waitTicks(page, 10);
  const before = await page.evaluate((id) => {
    const w = window.__cinder!.sim.state.guild.watch.find((x) => x.id === id)!;
    return { hull: w.hull, shield: w.shield, pos: w.body.pos };
  }, patrol);
  await aimAt(page, before.pos);
  await page.mouse.down({ button: 'left' });
  for (let i = 0; i < 8; i++) {
    const at = await page.evaluate((id) => window.__cinder!.sim.state.guild.watch.find((x) => x.id === id)!.body.pos, patrol);
    await aimAt(page, at, false);
    await waitTicks(page, 10);
  }
  await shot(page, 'watch-no-friendly-fire-sk');
  await page.mouse.up({ button: 'left' });
  await waitTicks(page, 20);
  const fired = (await recorded(page, 'shotFired')).filter((e) => e.owner === 'player');
  expect(fired.length, 'the player fired').toBeGreaterThan(0);
  const after = await page.evaluate((id) => {
    const w = window.__cinder!.sim.state.guild.watch.find((x) => x.id === id)!;
    return { hull: w.hull, shield: w.shield, mode: w.mode };
  }, patrol);
  expect(after.hull).toBe(before.hull);
  expect(after.shield).toBe(before.shield);
  expect(after.mode).toBe('patrol');
  expect((await recorded(page, 'npcHit')).filter((e) => e.by === 'player')).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __guildThrough: number }).__guildThrough), 'shots flew through the hull').toBeGreaterThan(0);

  // a pirate attacks the player near the patrol: the Watch comes to help ("We have your back, pilot.")
  await page.evaluate(async (m: Modules) => {
    const E = (await import(/* @vite-ignore */ m.enemies)) as EnemiesM;
    const s = window.__cinder!.sim.state;
    (window as unknown as { __guildPin: null }).__guildPin = null;
    const p = s.player.body.pos;
    const pos = { x: p.x + 140, y: p.y + 60 };
    const e = E.createEnemy({ id: 'e2e:defend:0', kind: 'jackal', tier: 1, pos, angle: Math.atan2(p.y - pos.y, p.x - pos.x), home: pos, orbit: 1 });
    e.ai.mode = 'attack';
    s.combat.enemies.push(e);
  }, MOD);
  await shield(page);
  await ff(page, 600, `s.guild.watch.some((w) => w.target === 'e2e:defend:0')`);
  const defending = await page.evaluate(() => window.__cinder!.sim.state.guild.watch.filter((w) => w.target === 'e2e:defend:0').map((w) => w.mode));
  expect(defending.length).toBeGreaterThan(0);
  expect(defending).toContain('engage');
  const engaged = await waitEvent(page, 'watchEngaged', { target: 'e2e:defend:0' });
  expect(engaged.id).toBeTruthy();
  await expect.poll(async () => (await radio(page)).some((r) => /Kryjeme ťa|Drž sa pri nás|Vydrž|piráti pri tebe/.test(r.text)), { timeout: 20_000 }).toBe(true);
  await shield(page, false);
  await page.mouse.move(900, 600);
  await waitTicks(page, 30);
  await shot(page, 'watch-defends-sk');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// convoys: link and trade

/** The pass in flight nearest the ship: its trader pose, velocity and the link pose for a ship gap `gap`. */
async function convoyHere(page: Page, gap: number): Promise<{ pass: string; vel: Vec; trader: Vec; heading: number; link: { pos: Vec; angle: number } }> {
  return page.evaluate(
    async ([m, g]) => {
      const S = (await import(/* @vite-ignore */ m.schedule)) as ScheduleM;
      const L = (await import(/* @vite-ignore */ m.link)) as LinkM;
      const s = window.__cinder!.sim.state;
      const pos = s.player.body.pos;
      const pose = S.convoysInFlight(s.seed, s.tick + 1).sort(
        (a, b) => Math.hypot(a.ships[0]!.pos.x - pos.x, a.ships[0]!.pos.y - pos.y) - Math.hypot(b.ships[0]!.pos.x - pos.x, b.ships[0]!.pos.y - pos.y),
      )[0]!;
      const link = L.linkPose(pose, s.player.props.boundingRadius + g);
      return { pass: pose.pass, vel: { ...pose.vel }, trader: { ...pose.ships[0]!.pos }, heading: pose.ships[0]!.heading, link };
    },
    [MOD, gap] as const,
  );
}

/**
 * Holds the ship 30 u off the port side of the trader of `pass` at the convoy's velocity, the trader in the
 * guns' arc, and counts the player's shots that flew on past its hull (`window.__guildThrough`).
 */
async function pinBesideTrader(page: Page, pass: string): Promise<void> {
  await page.evaluate(
    async ([m, GUN, id]) => {
      const S = (await import(/* @vite-ignore */ m.schedule)) as ScheduleM;
      const w = window as unknown as { __guildPin?: (() => void) | null; __guildThrough?: number };
      w.__guildThrough = 0;
      w.__guildPin = () => {
        const s = window.__cinder!.sim.state;
        const pose = S.convoyAt(s.seed, id, s.tick + 1);
        if (!pose) return;
        const t = pose.ships[0]!;
        const side = t.heading + Math.PI / 2;
        const pos = { x: t.pos.x + Math.cos(side) * 30, y: t.pos.y + Math.sin(side) * 30 };
        const body = { pos, vel: { ...pose.vel }, angle: side + Math.PI - GUN, angVel: 0 };
        s.player.body = body;
        s.player.prevBody = body;
        s.player.energy = s.player.props.batteryCapacity;
        s.player.heat.clear();
        // a shot past the trader's centre, still on its line (relative to the convoy) = it flew through
        for (const p of s.combat.projectiles) {
          if (p.owner !== 'player') continue;
          const rv = { x: p.vel.x - pose.vel.x, y: p.vel.y - pose.vel.y };
          const sp = Math.hypot(rv.x, rv.y) || 1;
          const dx = p.pos.x - t.pos.x;
          const dy = p.pos.y - t.pos.y;
          const along = (dx * rv.x + dy * rv.y) / sp;
          const across = Math.abs(dx * rv.y - dy * rv.x) / sp;
          if (along > 2 && along < 30 && across < 6) w.__guildThrough!++;
        }
      };
    },
    [MOD, GUN_BEARING, pass] as const,
  );
}

const unpin = (page: Page) => page.evaluate(() => ((window as unknown as { __guildPin: null }).__guildPin = null));

test('convoy: the approach readout, F links at the trade port, buy a rare item, sell iron (refined first), tanker fuel, F unlinks – shots fly through', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await start(page, 'convoy-near');
  // the flyby chip
  await expect(page.getByTestId('event-chips')).toContainText('Prelet konvoja');
  await page.mouse.move(900, 600);
  await waitTicks(page, 10);
  await shot(page, 'convoy-near-sk');

  // 12 u off the trade port at the convoy's velocity: the approach readout titled for the convoy link
  const c = await convoyHere(page, 12);
  await place(page, c.link.pos, c.link.angle, c.vel);
  await waitTicks(page, 10);
  const approach = page.getByTestId('dock-approach');
  await expect(approach).toBeVisible();
  await expect(approach).toHaveAttribute('aria-label', 'Pripojenie ku konvoju');
  await expect(approach).toHaveAttribute('data-ready', '0');
  await expect(page.getByTestId('dock-prompt')).toBeVisible();
  await settleCamera(page);
  await shot(page, 'convoy-approach-sk');
  // F too far: refused with the distance
  await page.keyboard.press('KeyF');
  const refused = await waitEvent(page, 'linkRejected');
  expect(refused.reason).toBe('tooFar');
  expect(await page.evaluate(() => window.__cinder!.sim.state.convoys.link)).toBeNull();

  // the dev helper: 2 u off the port at the convoy's velocity (dampers off – they would stop the ship); the
  // hunting captain's party (it comes within 300 u now and then and would unlink the ship) shot down first
  await defeat(page, '');
  const req = await page.evaluate(() => window.__cinder!.guild!.convoyNear());
  expect((await actionResult(page, req)).ok).toBe(true);
  await expect(approach).toHaveAttribute('data-ready', '1', { timeout: 10_000 });
  await page.keyboard.press('KeyF');
  const linked = await waitEvent(page, 'convoyLinked');
  expect(linked.pass).toBe(c.pass);
  const trade = page.getByTestId('convoy-trade');
  await expect(trade).toBeVisible();
  await expect(trade).toHaveAttribute('data-pass', c.pass);
  await expect(trade).toContainText('Obchod konvoja');
  await expect(page.getByTestId('dock-approach')).toBeHidden();
  await waitTicks(page, 20);
  await shot(page, 'convoy-trade-sk');

  // buy a rare item (the first buyable one)
  const items = await trade.locator('[data-testid^="convoy-item-"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid')!, state: e.getAttribute('data-state') })));
  expect(items.length).toBe(3);
  const credits0 = await page.evaluate(() => window.__cinder!.sim.state.credits);
  const buyable = items.filter((i) => i.state === 'buyable');
  expect(buyable.length).toBeGreaterThan(0);
  const slot = buyable[0]!.id.slice('convoy-item-'.length);
  await page.getByTestId(`convoy-buy-${slot}`).click();
  await expect(page.getByTestId(`convoy-sold-${slot}`)).toBeVisible();
  const bought = (await recorded(page, 'convoyTraded')).at(-1)!;
  expect(bought.what === 'fragment' || bought.what === 'part').toBe(true);
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(credits0 + (bought.credits as number));

  // sell 50 iron: the refined 40 go first (with their bonus)
  const before = await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    return { iron: p.cargo.iron, refined: p.refined.iron, credits: window.__cinder!.sim.state.credits };
  });
  expect(before).toMatchObject({ iron: 120, refined: 40 });
  await expect(page.getByTestId('convoy-sell-iron')).toContainText('40');
  await page.getByTestId('convoy-sell').getByRole('button', { name: '50', exact: true }).click();
  await page.getByTestId('convoy-sell-iron-act').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.cargo.iron < 120);
  const sold = await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    return { iron: p.cargo.iron, refined: p.refined.iron, credits: window.__cinder!.sim.state.credits };
  });
  expect(sold.iron).toBeCloseTo(70, 5);
  expect(sold.refined).toBe(0);
  expect(sold.credits).toBeGreaterThan(before.credits);
  await expect(page.getByTestId('convoy-cap')).toContainText('150');

  // tanker fuel: fill up (at most 60 u per pass)
  const fuel0 = await page.evaluate(() => window.__cinder!.sim.state.player.fuel);
  await page.getByTestId('convoy-fuel-full').click();
  await page.waitForFunction((f) => window.__cinder!.sim.state.player.fuel > f + 1, fuel0);
  const fuel1 = await page.evaluate(() => window.__cinder!.sim.state.player.fuel);
  expect(fuel1 - fuel0).toBeLessThanOrEqual(60 + 1e-6);
  expect((await recorded(page, 'convoyTraded')).some((e) => e.what === 'fuel')).toBe(true);
  await page.mouse.move(10, 700);
  await waitTicks(page, 10);
  await shot(page, 'convoy-trade-after-sk');

  // the rest of the rare goods (the trader's containers go once the pass is sold out; credits: a state edit)
  await page.evaluate(() => (window.__cinder!.sim.state.credits += 10_000));
  for (const it of items) {
    const s = it.id.slice('convoy-item-'.length);
    if ((await page.getByTestId(it.id).getAttribute('data-state')) !== 'buyable') continue;
    await page.getByTestId(`convoy-buy-${s}`).click();
    await expect(page.getByTestId(`convoy-sold-${s}`)).toBeVisible();
  }
  const soldOut = await page.evaluate((pass) => window.__cinder!.sim.state.convoys.trades.get(pass)!.bought, c.pass);

  // F unlinks (the focus is in the window: the key reaches its handler)
  await page.keyboard.press('KeyF');
  const unlinked = await waitEvent(page, 'convoyUnlinked');
  expect(unlinked.reason).toBe('player');
  await expect(trade).toBeHidden();
  expect(await page.evaluate(() => window.__cinder!.sim.state.convoys.link)).toBeNull();
  // drifting on beside the port with the convoy's velocity: the link readout stays quiet for a while
  await waitTicks(page, 20);
  await expect(approach).toBeHidden();
  await shot(page, 'convoy-unlinked-sk');

  // the player's shots fly through the trader (no friendly fire): held 30 u off its port side
  await pinBesideTrader(page, c.pass);
  await waitTicks(page, 10);
  const traderNow = async () => (await convoyHere(page, 0)).trader;
  await aimAt(page, await traderNow());
  await page.mouse.down({ button: 'left' });
  for (let i = 0; i < 8; i++) {
    await aimAt(page, await traderNow(), false);
    await waitTicks(page, 10);
  }
  // the sold-out pass: the trader flies without its containers
  expect(soldOut).toBe(7);
  await shot(page, 'convoy-sold-out-shots-sk');
  await page.mouse.up({ button: 'left' });
  await unpin(page);
  expect((await recorded(page, 'shotFired')).filter((e) => e.owner === 'player').length, 'the player fired').toBeGreaterThan(0);
  expect((await recorded(page, 'projectileHit')).filter((e) => e.owner === 'player')).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __guildThrough: number }).__guildThrough), 'shots flew through the trader').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// the escort contract

/** The escort record and the trader pose of the active escort contract. */
async function escortNow(page: Page): Promise<{ serial: number; state: string; progress: number; to: number; fired: number; hulls: number[]; deposit: number; trader: Vec | null }> {
  return page.evaluate(async (m: Modules) => {
    const E = (await import(/* @vite-ignore */ m.escort)) as EscortM;
    const s = window.__cinder!.sim.state;
    const c = s.career.contracts.find((x) => x.target.kind === 'escort')!;
    const e = s.convoys.escorts.get(c.serial)!;
    const t = c.target as Extract<typeof c.target, { kind: 'escort' }>;
    const ships = e ? E.escortShips(s, c.serial, e, t) : [];
    return { serial: c.serial, state: e?.state ?? 'none', progress: e?.progress ?? 0, to: t.to, fired: e?.fired ?? 0, hulls: e?.hulls ?? [], deposit: e?.deposit ?? 0, trader: ships[0] ? { ...ships[0].pos } : null };
  }, MOD);
}

/** Holds the ship 30 u off the trader's port side, flying with it, kept whole (`__guildPin`). */
async function escortAlongside(page: Page, serial: number): Promise<void> {
  await page.evaluate(
    async ([m, n]) => {
      const E = (await import(/* @vite-ignore */ m.escort)) as EscortM;
      const w = window as unknown as { __guildPin?: (() => void) | null };
      w.__guildPin = () => {
        const s = window.__cinder!.sim.state;
        const c = s.career.contracts.find((x) => x.serial === n);
        const e = s.convoys.escorts.get(n);
        if (!c || !e || c.target.kind !== 'escort') return;
        const t = E.escortShips(s, n, e, c.target)[0];
        if (!t) return;
        const side = t.heading + Math.PI / 2;
        const body = { pos: { x: t.pos.x + Math.cos(side) * 30, y: t.pos.y + Math.sin(side) * 30 }, vel: { ...t.vel }, angle: t.heading, angVel: 0 };
        const p = s.player;
        p.body = body;
        p.prevBody = body;
        p.dampers = false;
        if (p.hp.size > 0) p.hp = new Map();
        p.energy = p.props.batteryCapacity;
        s.world.update(body.pos);
      };
    },
    [MOD, serial] as const,
  );
}

test('escort: the deposit held, the convoy departs, an ambush stops it, it resumes, arrives – deposit back, turn-in pays', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await start(page, 'escort');
  const e0 = await escortNow(page);
  expect(e0.state).toBe('waiting');
  expect(e0.deposit).toBeGreaterThan(0);
  const credits0 = await page.evaluate(() => window.__cinder!.sim.state.credits);
  const reward = await page.evaluate((n) => window.__cinder!.sim.state.career.contracts.find((c) => c.serial === n)!.reward, e0.serial);
  expect(e0.deposit).toBe(Math.round(reward * 0.1));
  // the escort chip: waiting at the meeting point
  const chip = page.getByTestId('guild-escort');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-state', 'waiting');
  await page.mouse.move(900, 600);
  await waitTicks(page, 10);
  await shot(page, 'escort-waiting-sk');

  // within 150 u of the convoy it departs
  const t0 = e0.trader!;
  const me = await page.evaluate(() => ({ ...window.__cinder!.sim.state.player.body.pos }));
  const d = Math.hypot(me.x - t0.x, me.y - t0.y);
  await place(page, { x: t0.x + ((me.x - t0.x) / d) * 120, y: t0.y + ((me.y - t0.y) / d) * 120 }, Math.atan2(t0.y - me.y, t0.x - me.x));
  await waitEvent(page, 'escortDeparted', { serial: e0.serial });
  await expect(chip).toHaveAttribute('data-state', 'moving', { timeout: 10_000 });
  await expect.poll(async () => (await radio(page)).length, { timeout: 10_000 }).toBeGreaterThan(0);
  await escortAlongside(page, e0.serial);
  await waitTicks(page, 60);
  await settleCamera(page);
  await shot(page, 'escort-departed-sk');

  // each ambush: armed ahead of the convoy, the party comes in attacking, the convoy stops; beaten → it resumes
  const ambushes = await page.evaluate((n) => {
    const c = window.__cinder!.sim.state.career.contracts.find((x) => x.serial === n)!;
    return c.target.kind === 'escort' ? c.target.ambushes.length : 0;
  }, e0.serial);
  expect(ambushes).toBe(2);
  for (let k = 0; k < ambushes; k++) {
    const bit = 1 << k;
    for (let i = 0; i < 40 && ((await escortNow(page)).fired & bit) === 0; i++) await ff(page, 600, `(() => { const e = s.convoys.escorts.get(${e0.serial}); return !e || (e.fired & ${bit}) !== 0; })()`);
    const ambush = await waitEvent(page, 'escortAmbush', { serial: e0.serial });
    expect(ambush.pos).toBeTruthy();
    // the party spawns and the convoy stops while it is within 250 u
    await ff(page, 1800, `(() => { const e = s.convoys.escorts.get(${e0.serial}); return !!e && e.state === 'stopped'; })()`);
    const stopped = await escortNow(page);
    expect(stopped.state).toBe('stopped');
    const party = await page.evaluate((n) => window.__cinder!.sim.state.combat.enemies.filter((x) => x.id.startsWith(`ea:${n}:`)).map((x) => x.id), e0.serial);
    expect(party.length).toBeGreaterThan(0);
    await expect(chip).toHaveAttribute('data-state', 'stopped', { timeout: 10_000 });
    if (k === 0) {
      await expect(page.getByTestId('guild-escort-hull').first()).toBeVisible();
      await waitTicks(page, 20);
      await shot(page, 'escort-ambush-sk');
    }
    // the party beaten (state edit) → the convoy resumes 5 s later
    await defeat(page, `ea:${e0.serial}:`);
    await ff(page, 600, `(() => { const e = s.convoys.escorts.get(${e0.serial}); return !!e && e.state === 'moving'; })()`);
    expect((await escortNow(page)).state).toBe('moving');
  }
  expect((await recorded(page, 'escortStopped')).length).toBeGreaterThanOrEqual(1);

  // the arrival: done, the deposit paid back, the contract ready
  const before = await page.evaluate(() => window.__cinder!.sim.state.credits);
  for (let i = 0; i < 40; i++) {
    const n = await ff(page, 600, `(() => { const e = s.convoys.escorts.get(${e0.serial}); return !e || e.state === 'done'; })()`);
    if (n < 600) break;
  }
  const done = await escortNow(page);
  expect(done.state).toBe('done');
  expect(done.deposit).toBe(0);
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(before + e0.deposit);
  const ready = await page.evaluate((n) => window.__cinder!.sim.state.career.contracts.find((c) => c.serial === n)?.ready ?? null, e0.serial);
  expect(ready).toBe(true);
  expect(await recorded(page, 'contractFailed')).toEqual([]);
  await unpin(page);
  await waitTicks(page, 20);
  await shot(page, 'escort-arrived-sk');

  // turn in at the station the slip came from: the reward (the deposit came back on arrival)
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    const body = { pos: { x: 120, y: 40 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    s.player.body = body;
    s.player.prevBody = body;
    s.player.dampers = true;
    s.combat.enemies = [];
    s.world.update(body.pos);
  });
  await waitTicks(page, 10);
  await dockAtClamp(page, { stationId: 'home' });
  await page.getByTestId('tab-board').click();
  const credits1 = await page.evaluate(() => window.__cinder!.sim.state.credits);
  await page.getByTestId(`turnin-${e0.serial}`).click();
  await page.waitForFunction((n) => !window.__cinder!.sim.state.career.contracts.some((c) => c.serial === n), e0.serial);
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(credits1 + reward);
  expect(credits1).toBeGreaterThanOrEqual(credits0 + e0.deposit);
  expect(await page.evaluate((n) => window.__cinder!.sim.state.convoys.escorts.has(n), e0.serial)).toBe(false);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// the map planner

/** The map planner's data now (the game's own view model: route, notes, stale marks). */
const mapPlanData = (page: Page) =>
  page.evaluate(() => {
    const game = window.__cinder!.game as unknown as {
      mapPlan: { mapData(state: unknown, sectors: null): { route: { distance: number; fuel: number; short: number | null } | null; notes: { id: number; text: string }[]; stale: { kind: string; ageSeconds: number; alpha: number }[] } };
    };
    const d = game.mapPlan.mapData(window.__cinder!.sim.state, null);
    return { route: d.route, notes: d.notes.map((n) => ({ id: n.id, text: n.text })), stale: d.stale.map((m) => ({ kind: m.kind, ageSeconds: m.ageSeconds, alpha: m.alpha })) };
  });

/** Opens the map (M) and returns the display's box. */
async function openMap(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  await waitTicks(page, 5);
  return (await page.getByTestId('map-canvas').boundingBox())!;
}

/** A plain click on the map display (press and release without a drag). */
async function clickMap(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

async function mapScreens(page: Page, lang: 'sk' | 'en'): Promise<void> {
  const errors = await start(page, 'map-notes');
  const L = lang === 'sk' ? { route: 'Trasa', short: 'Palivo nestačí', note: 'Bohaté Ti, piráti', edited: 'Bohaté Ti' } : { route: 'Route', short: 'Not enough fuel', note: 'Rich Ti, pirates', edited: 'Rich Ti' };
  expect((await page.evaluate(() => window.__cinder!.sim.state.navigation.notes.length))).toBe(4);
  // the pirates and the comet nucleus seen on the radar – then the ship flies off (a tow 1 500 u back)
  await waitTicks(page, 30);
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    const p = s.player.body.pos;
    const l = Math.hypot(p.x, p.y) || 1;
    const body = { pos: { x: p.x - (p.x / l) * 1500, y: p.y - (p.y / l) * 1500 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    s.player.body = body;
    s.player.prevBody = body;
    s.player.dampers = true;
    s.world.update(body.pos);
  });
  // a minute later: two stale marks (pirates, comet) with their age, fading
  await waitTicks(page, 10);
  await ff(page, 3600);
  // the radar view is observed at the HUD redraw (10 Hz): one after the fast-forward
  await waitTicks(page, 10);
  const stale = (await mapPlanData(page)).stale;
  expect(stale.map((m) => m.kind).sort()).toEqual(['comet', 'pirates']);
  for (const m of stale) {
    expect(m.ageSeconds).toBeGreaterThanOrEqual(55);
    expect(m.alpha).toBeLessThan(1);
  }

  // the notes as flight marks (edge arrows / pins within 3 000 u, the in-flight marks setting)
  await waitTicks(page, 10);
  // (an arrow is a zero-size anchor with its glyph and label around it: attached, not "visible")
  await expect(page.locator('[data-testid="nav-arrow-note"], [data-testid="nav-pin-note"]').first()).toBeAttached({ timeout: 10_000 });
  await page.mouse.move(900, 600);
  await shot(page, `map-notes-flight-${lang}`);

  // the map: the stale marks and the notes in the legend, the planner tools
  const box = await openMap(page);
  await expect(page.getByTestId('map-tools')).toBeVisible();
  await expect(page.getByTestId('map-note-tool')).toContainText('4');
  const legend = page.getByTestId('map-legend');
  await expect(legend.locator('[data-layer="notes"]')).toBeVisible();
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await waitTicks(page, 5);
  await shot(page, `map-stale-notes-${lang}`);

  // right-click: a route to the point with its distance, time and fuel, the range circles on the display
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx + 180, cy - 120, { button: 'right' });
  const route = page.getByTestId('map-route');
  await expect(route).toBeVisible();
  await expect(route).toContainText(L.route);
  await expect(page.getByTestId('map-route-short')).toHaveCount(0);
  const planned = (await mapPlanData(page)).route!;
  expect(planned.distance).toBeGreaterThan(0);
  expect(planned.fuel).toBeGreaterThan(0);
  expect(planned.short).toBeNull();
  await waitTicks(page, 5);
  await shot(page, `map-route-${lang}`);
  // the tank nearly empty (state edit): the short-fuel warning
  await page.evaluate(() => (window.__cinder!.sim.state.player.fuel = 1));
  await expect(page.getByTestId('map-route-short')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('map-route-short')).toContainText(L.short);
  await waitTicks(page, 5);
  await shot(page, `map-route-short-${lang}`);
  await page.evaluate(() => (window.__cinder!.sim.state.player.fuel = window.__cinder!.sim.state.player.props.fuelCapacity));
  await page.getByTestId('map-route-clear').click();
  await expect(route).toBeHidden();

  // N: the note tool; a click places a note, the editor takes its text
  await page.keyboard.press('KeyN');
  await expect(page.getByTestId('map-note-tool')).toHaveAttribute('aria-pressed', 'true');
  const at = { x: cx - 160, y: cy + 90 };
  await clickMap(page, at.x, at.y);
  const editor = page.getByTestId('map-note-editor');
  await expect(editor).toBeVisible();
  await page.getByTestId('map-note-input').fill(L.note);
  await waitTicks(page, 3);
  await shot(page, `map-note-editor-${lang}`);
  await page.getByTestId('map-note-save').click();
  await expect(editor).toBeHidden();
  await page.waitForFunction(() => window.__cinder!.sim.state.navigation.notes.length === 5);
  const added = await page.evaluate(() => window.__cinder!.sim.state.navigation.notes.at(-1)!);
  expect(added.text).toBe(L.note);
  // a click on the note opens it: edit the text
  await clickMap(page, at.x, at.y);
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('map-note-delete')).toBeVisible();
  await page.getByTestId('map-note-input').fill(L.edited);
  await page.getByTestId('map-note-save').click();
  await page.waitForFunction(([id, t]) => window.__cinder!.sim.state.navigation.notes.find((n) => n.id === id)?.text === t, [added.id, L.edited] as const);
  // …and delete it
  await clickMap(page, at.x, at.y);
  await expect(editor).toBeVisible();
  await page.getByTestId('map-note-delete').click();
  await page.waitForFunction((id) => !window.__cinder!.sim.state.navigation.notes.some((n) => n.id === id), added.id);
  expect(await page.evaluate(() => window.__cinder!.sim.state.navigation.notes.length)).toBe(4);

  // the layers 7 (convoys and the Guild) and 8 (notes) toggle with their digits
  const convoys = page.getByTestId('map-layer-convoys');
  const notes = page.getByTestId('map-layer-notes');
  await expect(convoys).toHaveAttribute('aria-pressed', 'true');
  await expect(notes).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Digit7');
  await expect(convoys).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Digit8');
  await expect(notes).toHaveAttribute('aria-pressed', 'false');
  await expect(legend.locator('[data-layer="notes"]')).toHaveCount(0);
  await page.keyboard.press('Digit7');
  await page.keyboard.press('Digit8');
  await expect(convoys).toHaveAttribute('aria-pressed', 'true');
  await expect(notes).toHaveAttribute('aria-pressed', 'true');

  // a route planned on the map shows in flight as an edge arrow
  await page.mouse.click(cx + 260, cy - 180, { button: 'right' });
  await expect(route).toBeVisible();
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeHidden();
  await expect(page.locator('[data-testid="nav-arrow-route"], [data-testid="nav-pin-route"]').first()).toBeAttached({ timeout: 10_000 });
  await waitTicks(page, 5);
  await shot(page, `map-route-flight-${lang}`);
  expect(errors).toEqual([]);
}

test('map planner: stale marks, notes in flight, right-click route with fuel and the short-fuel warning, notes N add / edit / delete, layers 7–8', async ({ page }) => {
  test.setTimeout(240_000);
  await mapScreens(page, 'sk');
});

// ---------------------------------------------------------------------------
// save / load mid-link, the live language switch with the trade window open

test('convoy link: save / load keeps the link and the pass\'s trade; SK → EN live with the trade window open', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await start(page, 'convoy-linked');
  await defeat(page, '');
  const trade = page.getByTestId('convoy-trade');
  await expect(trade).toBeVisible();
  const pass = (await trade.getAttribute('data-pass'))!;
  expect(await page.evaluate(() => window.__cinder!.sim.state.convoys.link?.pass)).toBe(pass);
  // one item bought before the save
  const slot = (await trade.locator('[data-state="buyable"]').first().getAttribute('data-testid'))!.slice('convoy-item-'.length);
  await page.getByTestId(`convoy-buy-${slot}`).click();
  await expect(page.getByTestId(`convoy-sold-${slot}`)).toBeVisible();
  const before = await page.evaluate((p) => {
    const s = window.__cinder!.sim.state;
    return { link: { ...s.convoys.link! }, trade: { ...s.convoys.trades.get(p)! }, credits: s.credits };
  }, pass);

  // save → load mid-link: still linked to the same pass, the window open again, the item still sold
  await saveAndLoad(page);
  const after = await page.evaluate((p) => {
    const s = window.__cinder!.sim.state;
    return { link: s.convoys.link ? { ...s.convoys.link } : null, trade: s.convoys.trades.get(p) ? { ...s.convoys.trades.get(p)! } : null, credits: s.credits };
  }, pass);
  expect(after).toEqual(before);
  await expect(trade).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`convoy-sold-${slot}`)).toBeVisible();
  // the link holds on after the load (the ship rides beside the port)
  await waitTicks(page, 60);
  expect(await page.evaluate(() => window.__cinder!.sim.state.convoys.link?.pass)).toBe(pass);
  expect((await recorded(page, 'convoyUnlinked')).length).toBe(0);
  await page.mouse.move(10, 700);
  await shot(page, 'convoy-linked-reloaded-sk');

  // SK → EN live (the settings switch; Esc in the window would unlink, so the app's own setter): the open
  // window re-renders in English, the link stays
  await expect(trade).toContainText('Obchod konvoja');
  await page.evaluate(() => (window as unknown as { __cinderApp: { updateSettings(p: { language: 'en' | 'sk' }): void } }).__cinderApp.updateSettings({ language: 'en' }));
  // the English texts download first (only the active language is loaded)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(trade).toContainText('Convoy trade', { timeout: 5_000 });
  await expect(trade).not.toContainText('Obchod konvoja');
  await expect(page.getByTestId(`convoy-sold-${slot}`)).toContainText(/sold/i);
  expect(await page.evaluate(() => window.__cinder!.sim.state.convoys.link?.pass)).toBe(pass);
  await waitTicks(page, 10);
  await shot(page, 'convoy-trade-en');
  // …and back
  await page.evaluate(() => (window as unknown as { __cinderApp: { updateSettings(p: { language: 'en' | 'sk' }): void } }).__cinderApp.updateSettings({ language: 'sk' }));
  await expect(trade).toContainText('Obchod konvoja', { timeout: 5_000 });
  // Esc unlinks (the window's own key)
  await page.keyboard.press('Escape');
  await expect(trade).toBeHidden();
  expect((await waitEvent(page, 'convoyUnlinked')).reason).toBe('player');
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// English

test.describe('English', () => {
  test.use({ firstLaunchLanguage: 'en' });

  test('EN: the relay chip, the hold warning and the counterattack', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await start(page, 'relay-hold');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    const chip = page.getByTestId('guild-relay');
    await expect(chip).toContainText('Guild relay');
    const site = await relaySiteA(page);
    await powerRelay(page, site.receiver);
    await waitEvent(page, 'relayHoldStarted', { lane: 'A' });
    await expect(chip).toHaveAttribute('data-stage', 'powered');
    await page.mouse.move(900, 600);
    await waitTicks(page, 20);
    await shot(page, 'relay-hold-warning-en');
    await shield(page, true, true);
    await ff(page, 600, `s.combat.enemies.some((e) => e.id.startsWith('rc:A:'))`);
    await waitTicks(page, 30);
    await shot(page, 'relay-counterattack-en');
    await shield(page, false);
    expect(errors).toEqual([]);
  });

  test('EN: the convoy approach readout and the trade window', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await start(page, 'convoy-near');
    const c = await convoyHere(page, 12);
    await place(page, c.link.pos, c.link.angle, c.vel);
    await waitTicks(page, 10);
    await expect(page.getByTestId('dock-approach')).toHaveAttribute('aria-label', 'Convoy link');
    await settleCamera(page);
    await page.mouse.move(900, 600);
    await shot(page, 'convoy-approach-en');
    // the hunting captain's party comes closer than 300 u now and then – it would unlink the ship
    await defeat(page, '');
    const req = await page.evaluate(() => window.__cinder!.guild!.convoyNear());
    expect((await actionResult(page, req)).ok).toBe(true);
    await page.keyboard.press('KeyF');
    await waitEvent(page, 'convoyLinked');
    await expect(page.getByTestId('convoy-trade')).toContainText('Convoy trade');
    await page.mouse.move(10, 700);
    await waitTicks(page, 20);
    await shot(page, 'convoy-trade-fresh-en');
    expect(errors).toEqual([]);
  });

  test('EN: the escort chip, departed and stopped by an ambush', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await start(page, 'escort');
    const chip = page.getByTestId('guild-escort');
    await expect(chip).toContainText('Escort');
    const e0 = await escortNow(page);
    await place(page, { x: e0.trader!.x + 100, y: e0.trader!.y }, Math.PI);
    await waitEvent(page, 'escortDeparted', { serial: e0.serial });
    await escortAlongside(page, e0.serial);
    for (let i = 0; i < 40 && ((await escortNow(page)).fired & 1) === 0; i++) await ff(page, 600, `(() => { const e = s.convoys.escorts.get(${e0.serial}); return !e || (e.fired & 1) !== 0; })()`);
    await ff(page, 1800, `(() => { const e = s.convoys.escorts.get(${e0.serial}); return !!e && e.state === 'stopped'; })()`);
    await expect(chip).toHaveAttribute('data-state', 'stopped', { timeout: 10_000 });
    await waitTicks(page, 20);
    await shot(page, 'escort-ambush-en');
    await unpin(page);
    expect(errors).toEqual([]);
  });

  test('EN: the map planner – route, short fuel, notes, stale marks', async ({ page }) => {
    test.setTimeout(240_000);
    await mapScreens(page, 'en');
  });
});
