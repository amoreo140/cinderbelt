import { expect, test } from './test';
import type { Browser, Page } from '@playwright/test';
import { loadFixture, type FixtureName } from './fixtures';

// M4b "The world comes alive" (T16): the living world end to end from the test
// save positions (tests/fixtures/saves) – the micrometeor shower and the ambush forced through the dev
// hook (`window.__cinder.events.force`), the comet flyby, the derelict station (relays powered with the
// mining laser, sentries, berth with F, the terminal, a reload), the ship graveyard (analysis Data, live
// mines, the sleeping party), the Gunner's salvo tell and its evade, map / radar glyphs and the radio in
// Slovak and English. State is read through `window.__cinder`; the player acts with the real keys and
// mouse. Screenshots (SK and EN, 1280×720) go to the Playwright output folder (--output).

/** Game modules from the Vite server (in the browser). */
const MOD = {
  ambush: '/src/sim/events/ambush.ts',
  director: '/src/sim/events/director.ts',
  rng: '/src/sim/math/rng.ts',
  hash: '/src/sim/world/hash.ts',
  fnv: '/src/sim/math/fnv1a.ts',
  events: '/src/data/events.ts',
  pirates: '/src/data/pirates.ts',
  regions: '/src/sim/regions/index.ts',
  sectors: '/src/sim/pirates/sectors.ts',
  comets: '/src/sim/sites/comets.ts',
  relays: '/src/sim/sites/relays.ts',
  placement: '/src/sim/sites/placement.ts',
  mines: '/src/sim/sites/mines.ts',
  cometMap: '/src/game/sites/cometMapView.ts',
  looks: '/src/render/combat/enemyLooks.ts',
  serialize: '/src/sim/save/serialize.ts',
  load: '/src/sim/save/load.ts',
  i18n: '/src/i18n/index.ts',
  locale: '/src/i18n/locale.ts',
} as const;
type Modules = typeof MOD;
type AmbushM = typeof import('../../src/sim/events/ambush');
type DirectorM = typeof import('../../src/sim/events/director');
type RngM = typeof import('../../src/sim/math/rng');
type HashM = typeof import('../../src/sim/world/hash');
type FnvM = typeof import('../../src/sim/math/fnv1a');
type EventsM = typeof import('../../src/data/events');
type PiratesM = typeof import('../../src/data/pirates');
type RegionsM = typeof import('../../src/sim/regions');
type SectorsM = typeof import('../../src/sim/pirates/sectors');
type CometsM = typeof import('../../src/sim/sites/comets');
type RelaysM = typeof import('../../src/sim/sites/relays');
type PlacementM = typeof import('../../src/sim/sites/placement');
type MinesM = typeof import('../../src/sim/sites/mines');
type CometMapM = typeof import('../../src/game/sites/cometMapView');
type LooksM = typeof import('../../src/render/combat/enemyLooks');
type SerializeM = typeof import('../../src/sim/save/serialize');
type LoadM = typeof import('../../src/sim/save/load');
type I18nM = typeof import('../../src/i18n');
type LocaleM = typeof import('../../src/i18n/locale');

type Vec = { x: number; y: number };
/** A recorded sim event (the fields the specs read). */
type Rec = { type: string; tick: number } & Record<string, unknown>;

/** Sim events the recorder keeps (window.__svet). */
const RECORDED = [
  'eventWarning',
  'eventStarted',
  'eventEnded',
  'micrometeorHit',
  'ambushSpawned',
  'cometSighted',
  'relayCharging',
  'relayPowered',
  'derelictWoke',
  'berthed',
  'berthLeft',
  'berthRejected',
  'derelictVisited',
  'derelictTaken',
  'mineArmed',
  'mineExploded',
  'sleepersWoke',
  'tollDemanded',
  'analysisDone',
  'actionResult',
  'projectileFired',
];

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/svet-${name}.png` });

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

/** Records the step's sim events of the kinds above into `window.__svet` (again after a reload: a new sim). */
async function recordEvents(page: Page): Promise<void> {
  await page.evaluate((types) => {
    const w = window as unknown as { __svet?: Rec[]; __svetSim?: unknown };
    const sim = window.__cinder!.sim;
    w.__svet ??= [];
    if (w.__svetSim === sim) return;
    w.__svetSim = sim;
    const keep = new Set(types);
    const step = sim.step.bind(sim);
    sim.step = (cmd) => {
      const events = step(cmd);
      for (const e of events) if (keep.has(e.type)) w.__svet!.push({ ...(JSON.parse(JSON.stringify(e)) as Rec), tick: sim.state.tick });
      return events;
    };
  }, RECORDED);
}

const recorded = (page: Page, type: string): Promise<Rec[]> =>
  page.evaluate((t) => ((window as unknown as { __svet?: Rec[] }).__svet ?? []).filter((e) => e.type === t), type);

async function waitEvent(page: Page, type: string, match: Record<string, unknown> = {}, timeout = 60_000): Promise<Rec> {
  const handle = await page.waitForFunction(
    ([t, m]) => ((window as unknown as { __svet?: Rec[] }).__svet ?? []).find((e) => e.type === t && Object.entries(m).every(([k, v]) => e[k] === v)) ?? null,
    [type, match] as const,
    { timeout },
  );
  return (await handle.jsonValue()) as Rec;
}

/** What the radio received so far (speaker + text), oldest first. */
const radio = (page: Page): Promise<{ speaker: string; text: string }[]> =>
  page.evaluate(() =>
    (window.__cinder!.game as unknown as { comms: { queue: { transcript: { speaker: { name: string }; lines: string[]; note?: string; retext?: unknown }[] } } }).comms.queue.transcript.map((e) => ({
      speaker: e.speaker.name,
      text: [...e.lines, e.note ?? ''].join(' '),
    })),
  );

/** The texts of a language (the game's i18n tables). */
async function texts<T>(page: Page, locale: 'sk' | 'en', pick: (t: Awaited<ReturnType<I18nM['loadTexts']>>) => T): Promise<T> {
  return page.evaluate(
    async ([path, loc, fn]) => {
      const I = (await import(/* @vite-ignore */ path)) as I18nM;
      // only the active language is loaded in the game: fetch the other one's texts
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function('t', `return (${fn})(t)`)(await I.loadTexts(loc)) as T;
    },
    [MOD.i18n, locale, pick.toString()] as const,
  );
}

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
  // the cursor only aims on screen
  expect(at.x > 0 && at.x < 1280 && at.y > 0 && at.y < 720, `aim point ${Math.round(at.x)}, ${Math.round(at.y)} on screen`).toBe(true);
  await page.mouse.move(at.x, at.y);
  return at;
}

/** Hull points of the player's ship now. */
const hull = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    let sum = 0;
    for (const v of p.hp.values()) sum += v;
    return sum;
  });

/** Keeps the battery full and the lasers cool (long beams in a spec must not run dry). */
const keepCharged = (page: Page) =>
  page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.energy = p.props.batteryCapacity;
    p.heat.clear();
  });

async function start(page: Page, name: FixtureName): Promise<string[]> {
  const errors = trackErrors(page);
  await loadFixture(page, name, { ticks: 5 });
  await recordEvents(page);
  return errors;
}

// ---------------------------------------------------------------------------
// space events

test('micrometeor shower: warning chip with a countdown and the stream direction, hits land, the chip ends', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await start(page, 'derelict');
  const name = await texts(page, 'sk', (t) => t.world.events.names.micrometeors);

  const req = await page.evaluate(() => window.__cinder!.events!.force('micrometeors'));
  const ok = await waitEvent(page, 'actionResult', { reqId: req });
  expect(ok.ok).toBe(true);
  const warning = await waitEvent(page, 'eventWarning', { kind: 'micrometeors' });
  expect(warning.inSeconds).toBe(8);
  expect(typeof warning.dir).toBe('number');

  // the chip: the name, the countdown to the start (pending) and the stream direction dial
  const chip = page.getByTestId('event-chip-micrometeors');
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect(chip).toContainText(name);
  await expect(chip).toHaveClass(/is-pending/);
  await expect(chip.getByTestId('event-chip-dir')).toBeVisible();
  const left0 = await page.evaluate(() => window.__cinder!.events!.chips().find((c) => c.kind === 'micrometeors')!.secondsLeft!);
  expect(left0).toBeGreaterThan(0);
  expect(left0).toBeLessThanOrEqual(8);
  const time0 = await chip.getByTestId('event-chip-time').textContent();
  await waitTicks(page, 75);
  const left1 = await page.evaluate(() => window.__cinder!.events!.chips().find((c) => c.kind === 'micrometeors')?.secondsLeft ?? null);
  if (left1 !== null) expect(left1).toBeLessThan(left0);
  await expect(chip.getByTestId('event-chip-time')).not.toHaveText(time0 ?? '', { timeout: 10_000 });
  await shot(page, 'micrometeors-warning');

  // the shower: rays hit the first part along them (or the raised shield takes them)
  const started = await waitEvent(page, 'eventStarted', { kind: 'micrometeors' }, 30_000);
  expect(started.end as number).toBeGreaterThan(started.tick);
  await expect(chip).not.toHaveClass(/is-pending/, { timeout: 10_000 });
  await page.waitForFunction(() => ((window as unknown as { __svet: Rec[] }).__svet ?? []).filter((e) => e.type === 'micrometeorHit').length >= 2, undefined, { timeout: 60_000 });
  const hits = await recorded(page, 'micrometeorHit');
  for (const h of hits) {
    expect(h.damage as number).toBeGreaterThan(0);
    expect(typeof h.partId).toBe('number');
  }
  await shot(page, 'micrometeors-shower');

  // the end: the chip goes away (the rest of the shower is skipped – its trigger tick moved back)
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    const ev = window.__cinder!.events!.active().find((e) => e.kind === 'micrometeors')!;
    const fired = s.director.fired.get(ev.key)!;
    s.director.fired.set(ev.key, fired - (ev.end - s.tick) + 60);
  });
  await waitEvent(page, 'eventEnded', { kind: 'micrometeors' }, 30_000);
  await expect(chip).toBeHidden({ timeout: 10_000 });
  expect(errors).toEqual([]);
});

/**
 * Waits for a director bucket whose ambush party is Hammer-led and whose hail roll succeeds (the toll
 * hail is a fixed roll per party); returns the bucket. Fixtures are fixed, so this is deterministic.
 */
async function hailBucket(page: Page): Promise<number> {
  for (let i = 0; i < 4; i++) {
    const r = await page.evaluate(async (m: Modules) => {
      const A = (await import(/* @vite-ignore */ m.ambush)) as AmbushM;
      const D = (await import(/* @vite-ignore */ m.director)) as DirectorM;
      const R = (await import(/* @vite-ignore */ m.regions)) as RegionsM;
      const RNG = (await import(/* @vite-ignore */ m.rng)) as RngM;
      const H = (await import(/* @vite-ignore */ m.hash)) as HashM;
      const F = (await import(/* @vite-ignore */ m.fnv)) as FnvM;
      const E = (await import(/* @vite-ignore */ m.events)) as EventsM;
      const P = (await import(/* @vite-ignore */ m.pirates)) as PiratesM;
      const PS = (await import(/* @vite-ignore */ m.sectors)) as SectorsM;
      const s = window.__cinder!.sim.state;
      const pos = s.player.body.pos;
      const sector = R.sectorIdAt(s.seed, pos.x, pos.y);
      const depth = R.sectorInfo(s.seed, sector)!.depth;
      const bucket = Math.floor(s.tick / D.BUCKET_TICKS);
      const leader = A.ambushParty(s.seed, sector, bucket, depth).kinds[0];
      const roll = RNG.createRng(H.hash3(s.seed ^ E.AMBUSH.salt, F.fnv1a32(A.ambushGroup(sector, bucket)), 7))();
      const security = PS.securityHere(s, pos);
      // a bucket about to end: wait for the next one (the roll belongs to the bucket of the force)
      const left = (bucket + 1) * D.BUCKET_TICKS - s.tick;
      return { bucket, ok: leader === 'hammer' && roll < P.TOLL.chance[security] && left > 120, next: left };
    }, MOD);
    if (r.ok) return r.bucket;
    await waitTicks(page, r.next + 2);
  }
  throw new Error('no bucket with a hailing Hammer party within 4 buckets');
}

for (const { fixture, answer } of [
  { fixture: 'comet', answer: 'pay' },
  { fixture: 'derelict-dock', answer: 'refuse' },
] as const) {
  test(`ambush (${fixture}): radio warning, the party comes out of the dark, the Hammer hails – ${answer}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await start(page, fixture);
    const bucket = await hailBucket(page);
    const credits0 = await page.evaluate(() => window.__cinder!.sim.state.credits);
    const enemies0 = await page.evaluate(() => window.__cinder!.sim.state.combat.enemies.length);

    await page.evaluate(() => window.__cinder!.events!.force('ambush'));
    const warning = await waitEvent(page, 'eventWarning', { kind: 'ambush' });
    expect(String(warning.key)).toContain(`@${bucket}`);
    expect(warning.inSeconds).toBe(6);
    const chip = page.getByTestId('event-chip-ambush');
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip.getByTestId('event-chip-dir')).toBeVisible();
    // the chip drops in (a short animation) – let it land before the screenshot
    await page.waitForTimeout(600);
    await shot(page, `ambush-warning-${fixture}`);

    // the party spawns 300 u away on the announced bearing
    const spawned = await waitEvent(page, 'ambushSpawned', {}, 30_000);
    expect(spawned.leader).toBe('hammer');
    expect(spawned.count as number).toBeGreaterThanOrEqual(2);
    const party = await page.evaluate(() => {
      const s = window.__cinder!.sim.state;
      const p = s.player.body.pos;
      return s.combat.enemies.filter((e) => e.id.startsWith('ab:')).map((e) => ({ id: e.id, kind: e.kind, mode: e.ai.mode, d: Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y) }));
    });
    expect(party.length).toBe(spawned.count);
    expect(party[0]!.kind).toBe('hammer');
    for (const m of party) expect(m.d).toBeGreaterThan(250);
    // (chunk pirates may stream in meanwhile – the party comes on top of the enemies already there)
    expect(await page.evaluate(() => window.__cinder!.sim.state.combat.enemies.length)).toBeGreaterThanOrEqual(enemies0 + party.length);

    // they close in (moved in to save the flight time) – the Hammer hails for a toll
    await page.evaluate(() => {
      const s = window.__cinder!.sim.state;
      const p = s.player.body.pos;
      s.combat.enemies
        .filter((e) => e.id.startsWith('ab:'))
        .forEach((e, i) => {
          const body = { ...e.body, pos: { x: p.x + 55 + i * 9, y: p.y + 12 - i * 7 }, vel: { x: 0, y: 0 } };
          e.body = body;
          e.prevBody = body;
        });
    });
    const demand = await waitEvent(page, 'tollDemanded', {}, 30_000);
    expect(String(demand.group)).toMatch(/^ab:/);
    const panel = page.getByTestId('comm-panel');
    await expect(panel.getByTestId('toll')).toBeVisible({ timeout: 30_000 });
    await expect(chip).toBeVisible();
    await shot(page, `ambush-toll-${fixture}`);

    if (answer === 'pay') {
      await page.getByTestId('toll-pay').click();
      await page.waitForFunction(() => window.__cinder!.sim.state.pirates.toll === null, undefined, { timeout: 30_000 });
      expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(credits0 - (demand.amount as number));
      await waitTicks(page, 30);
      const modes = await page.evaluate(() => window.__cinder!.sim.state.combat.enemies.filter((e) => e.id.startsWith('ab:')).map((e) => e.ai.mode));
      expect(modes).not.toContain('attack');
    } else {
      await page.getByTestId('toll-refuse').click();
      await page.waitForFunction(() => window.__cinder!.sim.state.pirates.toll === null, undefined, { timeout: 30_000 });
      expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(credits0);
      await page.waitForFunction(() => window.__cinder!.sim.state.combat.enemies.filter((e) => e.id.startsWith('ab:')).every((e) => e.ai.mode === 'attack'), undefined, { timeout: 30_000 });
    }
    await shot(page, `ambush-${answer}-${fixture}`);
    // the radio announced the contacts (pirate voice) or the toll – at least one line of the event
    expect((await radio(page)).length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// comet

test('comet flyby: chip and radio, the nucleus is drawn and mined on the move, the map shows the pass', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await start(page, 'comet');
  const title = await texts(page, 'sk', (t) => t.world.comet.name(4));

  // the flyby chip (ETA, direction) and the radio line (the Institute's observatory)
  const chip = page.getByTestId('event-chip-cometFlyby');
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect(chip).toContainText(title);
  await expect(chip.getByTestId('event-chip-dir')).toBeVisible();
  await page.waitForFunction(
    (t) => (window.__cinder!.game as unknown as { comms: { queue: { transcript: { lines: string[] }[] } } }).comms.queue.transcript.some((e) => e.lines.join(' ').includes(t)),
    title,
    { timeout: 30_000 },
  );

  // the nucleus fades in at the start of its pass, then it is drawn opaque
  await page.waitForFunction(() => {
    const layer = (window.__cinder!.renderer as unknown as { comets: { entries: Map<string, { fade: number }> } }).comets;
    return [...layer.entries.values()].some((e) => e.fade > 0.999);
  }, undefined, { timeout: 60_000 });

  /** Puts the ship beside the nucleus, flying with it (its velocity, dampers off); returns the nucleus. */
  const alongside = () =>
    page.evaluate(async (m: Modules) => {
      const C = (await import(/* @vite-ignore */ m.comets)) as CometsM;
      const s = window.__cinder!.sim.state;
      const c = C.cometAt(s.seed, 'cm:3', s.tick)!;
      const speed = Math.hypot(c.vel.x, c.vel.y);
      // 14 u to the side of the track (the nucleus is 6 u, the lasers reach 18 u), bow at the nucleus
      const side = { x: -c.vel.y / speed, y: c.vel.x / speed };
      const pos = { x: c.pos.x + side.x * 14, y: c.pos.y + side.y * 14 };
      const body = { pos, vel: { ...c.vel }, angle: Math.atan2(c.pos.y - pos.y, c.pos.x - pos.x), angVel: 0 };
      s.player.body = body;
      s.player.prevBody = body;
      s.player.dampers = false;
      return c;
    }, MOD);

  const nucleus = await alongside();
  expect(Math.hypot(nucleus.vel.x, nucleus.vel.y)).toBeGreaterThan(29);
  await settleCamera(page);
  await alongside();
  await waitFrames(page, 3);
  const drawn = await page.evaluate(() => {
    const layer = (window.__cinder!.renderer as unknown as {
      comets: { stats(): { visible: number; shards: number }; entries: Map<string, { opaque: { visible: boolean }; root: { visible: boolean }; pose: { pos: Vec } | null }> };
    }).comets;
    const e = layer.entries.get('cm:3')!;
    return { stats: layer.stats(), opaque: e.opaque.visible, root: e.root.visible, screen: window.__cinder!.renderer.worldToScreen(e.pose!.pos) };
  });
  expect(drawn.stats.visible).toBe(1);
  expect(drawn.stats.shards).toBe(24);
  expect(drawn.root && drawn.opaque).toBe(true);
  // on screen at the game camera
  expect(drawn.screen.x).toBeGreaterThan(0);
  expect(drawn.screen.x).toBeLessThan(1280);
  expect(drawn.screen.y).toBeGreaterThan(0);
  expect(drawn.screen.y).toBeLessThan(720);
  await shot(page, 'comet-nucleus');

  // mining on the move: hold the beam on the moving nucleus – ice and titanium in the hold
  let mined = { ice: 0, titanium: 0, beams: 0 };
  await page.mouse.down({ button: 'right' });
  for (let i = 0; i < 40 && (mined.ice <= 0 || mined.titanium <= 0); i++) {
    // the ship coasts with the nucleus; back beside it only when the curved track drew them apart (a
    // jump makes the follow camera lag behind on a loaded machine), then aim where the nucleus is drawn
    const drift = await page.evaluate(async (m: Modules) => {
      const C = (await import(/* @vite-ignore */ m.comets)) as CometsM;
      const s = window.__cinder!.sim.state;
      const c = C.cometAt(s.seed, 'cm:3', s.tick)!;
      return Math.abs(Math.hypot(c.pos.x - s.player.body.pos.x, c.pos.y - s.player.body.pos.y) - 14);
    }, MOD);
    if (drift > 3) {
      await alongside();
      await settleCamera(page);
    }
    const at = await page.evaluate(async (m: Modules) => {
      const C = (await import(/* @vite-ignore */ m.comets)) as CometsM;
      const s = window.__cinder!.sim.state;
      return window.__cinder!.renderer.worldToScreen(C.cometAt(s.seed, 'cm:3', s.tick)!.pos);
    }, MOD);
    if (at.x > 0 && at.x < 1280 && at.y > 0 && at.y < 720) await page.mouse.move(at.x, at.y);
    await keepCharged(page);
    await waitTicks(page, 20);
    mined = await page.evaluate(() => {
      const p = window.__cinder!.sim.state.player;
      return { ice: p.cargo.ice, titanium: p.cargo.titanium, beams: p.beams.filter((b) => b.mover).length };
    });
  }
  await waitFrames(page, 3);
  await shot(page, 'comet-mining');
  await page.mouse.up({ button: 'right' });
  expect(mined.ice).toBeGreaterThan(0);
  expect(mined.titanium).toBeGreaterThan(0);
  const budget = await page.evaluate(() => [...window.__cinder!.sim.state.sites.comets.entries()]);
  expect(budget.find(([id]) => id === 'cm:3')).toBeTruthy();

  // the map: the comet is known – its pass track, the nucleus, the legend and the next pass near the ship
  const cometMap = await page.evaluate(async (m: Modules) => {
    const V = (await import(/* @vite-ignore */ m.cometMap)) as CometMapM;
    return V.cometMapData(window.__cinder!.sim.state).find((c) => c.id === 'cm:3') ?? null;
  }, MOD);
  expect(cometMap?.known).toBe(true);
  expect(cometMap!.arc.length).toBeGreaterThan(2);
  expect(cometMap!.now).not.toBeNull();
  // stopped, so the next pass near the ship is computed for a fixed point
  await place(page, await page.evaluate(() => ({ ...window.__cinder!.sim.state.player.body.pos })), 0);
  await page.keyboard.press('KeyM');
  const map = page.getByTestId('map');
  await expect(map).toBeVisible();
  await expect(page.getByTestId('map-legend')).toContainText(await texts(page, 'sk', (t) => t.world.map.comet));
  // hover the track: the label says when it passes near (searched outwards from the ship along the nucleus bearing)
  const box = (await page.getByTestId('map-canvas').boundingBox())!;
  const bearing = await page.evaluate(async (m: Modules) => {
    const C = (await import(/* @vite-ignore */ m.comets)) as CometsM;
    const s = window.__cinder!.sim.state;
    const c = C.cometAt(s.seed, 'cm:3', s.tick)!;
    return Math.atan2(c.pos.y - s.player.body.pos.y, c.pos.x - s.player.body.pos.x);
  }, MOD);
  let hovered = false;
  for (let r = 4; r < 160 && !hovered; r += 3) {
    await page.mouse.move(box.x + box.width / 2 + Math.cos(bearing) * r, box.y + box.height / 2 - Math.sin(bearing) * r);
    await waitFrames(page, 2);
    hovered = (await page.getByTestId('sector-card').count()) === 0;
  }
  await page.waitForTimeout(300);
  await shot(page, 'comet-map');
  await page.keyboard.press('KeyM');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// derelict station

test('derelict: relays powered with the laser, sentries wake, berth with F, the terminal gives once, reload keeps it', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = await start(page, 'derelict');
  const id = 'dl:-5,-9';
  const before = await page.evaluate((d) => window.__cinder!.sites!.derelict(d)!, id);
  expect(before.relays.map((r) => r.lit)).toEqual([true, false, false]);
  expect(before.state.woke).toBeNull();
  const data0 = await page.evaluate(() => window.__cinder!.sim.state.discovery.dataTotal);

  /** Flies to a relay (stopped 9 u out from its receiver lens) and holds the mining laser on the lens. */
  const powerRelay = async (relayId: string, lit: number) => {
    const lens = await page.evaluate(
      async ([m, rid, site]) => {
        const P = (await import(/* @vite-ignore */ m.placement)) as PlacementM;
        const R = (await import(/* @vite-ignore */ m.relays)) as RelaysM;
        const s = window.__cinder!.sim.state;
        const relay = P.relayById(s.seed, rid)!;
        const lens = R.receiverPos(relay);
        const center = P.siteById(s.seed, site)!.pos;
        const d = Math.hypot(lens.x - center.x, lens.y - center.y);
        const out = { x: (lens.x - center.x) / d, y: (lens.y - center.y) / d };
        const pos = { x: lens.x + out.x * 9, y: lens.y + out.y * 9 };
        const body = { pos, vel: { x: 0, y: 0 }, angle: Math.atan2(-out.y, -out.x), angVel: 0 };
        s.player.body = body;
        s.player.prevBody = body;
        s.player.dampers = true;
        return lens;
      },
      [MOD, relayId, id] as const,
    );
    await keepCharged(page);
    await aimAt(page, lens);
    await page.mouse.down({ button: 'right' });
    await waitEvent(page, 'relayCharging', { id: relayId }, 30_000);
    await shot(page, `derelict-relay-${lit}-charging`);
    for (let i = 0; i < 60; i++) {
      if ((await recorded(page, 'relayPowered')).some((e) => e.id === relayId)) break;
      await keepCharged(page);
      await aimAt(page, lens, false);
      await waitTicks(page, 15);
    }
    await page.mouse.up({ button: 'right' });
    const powered = await waitEvent(page, 'relayPowered', { id: relayId }, 30_000);
    expect(powered.site).toBe(id);
    expect(powered.lit).toBe(lit);
  };

  // relay 2: the station's defence wakes – sentry drones (radio)
  await powerRelay('dl:-5,-9:r1', 2);
  const woke = await waitEvent(page, 'derelictWoke', { id });
  expect(woke.defence).toBe('sentries');
  const sentries = await page.evaluate(() => window.__cinder!.sim.state.combat.enemies.filter((e) => e.id.startsWith('dd:')).map((e) => ({ id: e.id, kind: e.kind })));
  expect(sentries.length).toBe(2);
  for (const s of sentries) expect(s.kind).toBe('sentry');
  const wokeText = await texts(page, 'sk', (t) => t.world.toasts.woke.sentries);
  await page.waitForTimeout(800);
  const lines = await radio(page);
  const toast = await page.getByTestId('toast').textContent().catch(() => '');
  expect(lines.some((l) => /dron|stráž|sentry/i.test(l.text)) || (toast ?? '').includes(wokeText)).toBe(true);
  await shot(page, 'derelict-sentries-woke');
  // the drones are dealt with (destroyed – the fight itself is combat.spec's), they never respawn
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    for (const e of s.combat.enemies) if (e.id.startsWith('dd:')) s.combat.defeated.set(e.id, s.tick);
    s.combat.enemies = s.combat.enemies.filter((e) => !e.id.startsWith('dd:'));
  });

  // relay 3: the dock clamp is live
  await powerRelay('dl:-5,-9:r2', 3);
  await waitTicks(page, 60);
  expect(await page.evaluate(() => window.__cinder!.sim.state.combat.enemies.filter((e) => e.id.startsWith('dd:')).length)).toBe(0);

  // berth: at the clamp, F (the same manoeuvre rules as a station's dock)
  const berth = async () => {
    expect(await page.evaluate((d) => window.__cinder!.sites!.toClamp(d), id)).toBe(true);
    await page.waitForFunction((d) => window.__cinder!.berth!.candidate()?.id === d && window.__cinder!.berth!.candidate()?.status === 'ok', id, { timeout: 30_000 });
    await page.keyboard.press('KeyF');
    await page.waitForFunction((d) => window.__cinder!.berth!.id() === d, id, { timeout: 30_000 });
    await expect(page.getByTestId('derelict-terminal')).toBeVisible({ timeout: 30_000 });
  };
  await berth();
  const visited = await waitEvent(page, 'derelictVisited', { id });
  expect(visited.data).toBe(80);
  expect(await page.evaluate(() => window.__cinder!.sim.state.discovery.dataTotal)).toBe(data0 + 80);
  expect(await page.evaluate(() => window.__cinder!.sim.state.discovery.journal.map((j) => j.id))).toContain('derelictLog_c');
  const terminal = page.getByTestId('derelict-terminal');
  await expect(terminal).toHaveAttribute('data-model', 'c');
  await expect(terminal.getByTestId('terminal-data')).toContainText('80');
  await expect(terminal.getByTestId('terminal-service')).toHaveAttribute('data-service', 'stash');
  await page.waitForTimeout(400);
  await shot(page, 'derelict-terminal-sk');

  // take the first item once: into the part hold
  const salvage0 = await page.evaluate(() => ({ ...window.__cinder!.sim.state.player.salvage }) as Record<string, number>);
  await page.getByTestId('terminal-take-0').click();
  const taken = await waitEvent(page, 'derelictTaken', { id });
  const key = (taken.what as { kind: string; key: string }).key;
  expect((taken.what as { kind: string }).kind).toBe('part');
  await expect(terminal.getByTestId('terminal-taken-0')).toBeVisible();
  const salvage1 = await page.evaluate(() => ({ ...window.__cinder!.sim.state.player.salvage }) as Record<string, number>);
  expect(salvage1[key] ?? 0).toBe((salvage0[key] ?? 0) + 1);
  await shot(page, 'derelict-terminal-taken');

  // "Detach": the ship leaves the clamp; F again – the terminal remembers (Data downloaded, item taken)
  await page.getByTestId('terminal-leave').click();
  await waitEvent(page, 'berthLeft', { id });
  await expect(terminal).toBeHidden();
  await waitTicks(page, 30);
  await berth();
  await expect(terminal.getByTestId('terminal-taken-0')).toBeVisible();
  await expect(terminal.getByTestId('terminal-take-0')).toHaveCount(0);
  await expect(terminal.getByTestId('terminal-data')).toContainText(await texts(page, 'sk', (t) => t.world.derelict.terminal.dataDone));
  expect(await page.evaluate(() => window.__cinder!.sim.state.discovery.dataTotal)).toBe(data0 + 80);
  // a crafted take of the same item is refused
  const again = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.evaluate(() => window.__cinder!.sites!.terminalHandlers.take(0));
  await page.waitForFunction((t) => ((window as unknown as { __svet: Rec[] }).__svet ?? []).some((e) => e.type === 'actionResult' && e.tick > t && e.ok === false), again, { timeout: 30_000 });
  const refused = (await recorded(page, 'actionResult')).filter((e) => e.tick > again);
  expect(refused.at(-1)!.reason).toBe('itemTaken');

  // reload: save → load (migration + validation) → the game restarts from the save, still berthed
  await page.evaluate(async (m: Modules) => {
    const S = (await import(/* @vite-ignore */ m.serialize)) as SerializeM;
    const L = (await import(/* @vite-ignore */ m.load)) as LoadM;
    const now = '2026-10-19T12:00:00.000Z';
    const save = S.toSave(window.__cinder!.sim, { gameId: 'e2e-svet', name: 'e2e', createdAt: now, savedAt: now, reason: 'manual', gameVersion: 'e2e' });
    const loaded = L.loadSave(JSON.parse(JSON.stringify(S.toEnvelope(save))));
    if (!loaded.ok) throw new Error(`load: ${loaded.error}`);
    (window as unknown as { __svetOld: unknown }).__svetOld = window.__cinder!.sim;
    (window as unknown as { __cinderApp: { startSimulation(sim: unknown): void } }).__cinderApp.startSimulation(S.restoreSimulation(loaded.save));
  }, MOD);
  await page.waitForFunction(() => !!window.__cinder && window.__cinder.sim !== (window as unknown as { __svetOld: unknown }).__svetOld, undefined, { timeout: 60_000 });
  await waitTicks(page, 10);
  await recordEvents(page);
  await page.evaluate(() => {
    const game = window.__cinder!.game as unknown as { helpOpen: boolean; helpTouched: boolean };
    game.helpOpen = false;
    game.helpTouched = true;
  });
  expect(await page.evaluate(() => window.__cinder!.berth!.id())).toBe(id);
  await expect(terminal).toBeVisible({ timeout: 30_000 });
  await expect(terminal.getByTestId('terminal-taken-0')).toBeVisible();
  const afterLoad = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.evaluate(() => window.__cinder!.sites!.terminalHandlers.take(0));
  await page.waitForFunction((t) => ((window as unknown as { __svet: Rec[] }).__svet ?? []).some((e) => e.type === 'actionResult' && e.tick > t), afterLoad, { timeout: 30_000 });
  const reloaded = (await recorded(page, 'actionResult')).filter((e) => e.tick > afterLoad);
  expect(reloaded.at(-1)!.ok).toBe(false);
  expect(reloaded.at(-1)!.reason).toBe('itemTaken');
  expect(await page.evaluate(() => window.__cinder!.sim.state.discovery.dataTotal)).toBe(data0 + 80);
  expect(await page.evaluate((k) => (window.__cinder!.sim.state.player.salvage as Record<string, number>)[k] ?? 0, key)).toBe(salvage1[key]);
  await shot(page, 'derelict-terminal-reloaded');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// ship graveyard

test('graveyard: the first wreck analysis pays 35 D, a mine arms and blows, a mine shot from range, the sleepers wake', async ({ page }) => {
  test.setTimeout(360_000);
  const errors = await start(page, 'graveyard');
  const site = 'gy:-20,22';
  await waitTicks(page, 40);

  const layout = await page.evaluate((gy) => {
    const s = window.__cinder!.sim.state;
    const sleepers = s.combat.enemies.filter((e) => e.id.startsWith('gs:')).map((e) => ({ id: e.id, kind: e.kind, mode: e.ai.mode, pos: { ...e.body.pos } }));
    const wrecks = s.combat.wrecks.filter((w) => w.poi?.startsWith(`${gy}#`)).map((w) => ({ id: w.id, key: w.poi!, pos: { ...w.body.pos } }));
    return { sleepers, wrecks, center: { ...window.__cinder!.sites!.near(800).find((x) => x.id === gy)!.pos } };
  }, site);
  expect(layout.sleepers.length).toBe(3);
  for (const s of layout.sleepers) expect(s.mode).toBe('dormant');
  expect(layout.wrecks.length).toBeGreaterThan(0);
  const far = (p: Vec, r: number) => layout.sleepers.every((s) => Math.hypot(s.pos.x - p.x, s.pos.y - p.y) > r);

  /** Hold Tab with the cursor on a point until an analysis finishes; returns its event. */
  const analyse = async (pos: Vec, label: string) => {
    const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
    await keepCharged(page);
    await aimAt(page, pos);
    await page.keyboard.down('Tab');
    await page.waitForTimeout(700);
    await shot(page, label);
    await page.waitForFunction((t) => ((window as unknown as { __svet: Rec[] }).__svet ?? []).some((e) => e.type === 'analysisDone' && e.tick > t), t0, { timeout: 60_000 });
    await page.keyboard.up('Tab');
    return (await recorded(page, 'analysisDone')).filter((e) => e.tick > t0)[0]!;
  };

  // the first analysed wreck of the graveyard: 35 D once; the next wreck 0 D
  const wrecks = layout.wrecks.filter((w) => far(w.pos, 75));
  expect(wrecks.length).toBeGreaterThanOrEqual(2);
  const data0 = await page.evaluate(() => window.__cinder!.sim.state.discovery.dataTotal);
  const near = (w: Vec): Vec => {
    const d = Math.hypot(w.x - layout.center.x, w.y - layout.center.y) || 1;
    return { x: w.x + ((w.x - layout.center.x) / d) * 16, y: w.y + ((w.y - layout.center.y) / d) * 16 };
  };
  const w1 = wrecks[0]!;
  await place(page, near(w1.pos), Math.atan2(w1.pos.y - near(w1.pos).y, w1.pos.x - near(w1.pos).x));
  await waitTicks(page, 20);
  const first = await analyse(w1.pos, 'graveyard-analysis');
  expect(first.data).toBe(35);
  expect(await page.evaluate(() => window.__cinder!.sim.state.discovery.dataTotal)).toBe(data0 + 35);
  const w2 = wrecks[1]!;
  await place(page, near(w2.pos), Math.atan2(w2.pos.y - near(w2.pos).y, w2.pos.x - near(w2.pos).x));
  await waitTicks(page, 20);
  const second = await analyse(w2.pos, 'graveyard-analysis-2');
  expect(second.target).not.toBe(first.target);
  expect(await page.evaluate(() => window.__cinder!.sim.state.discovery.dataTotal)).toBe(data0 + 35);

  // live mines: radar contacts; one is armed by flying close (fast blink) – the ship gets out, it blows
  const mines = await page.evaluate(
    async ([m, at]) => {
      const M = (await import(/* @vite-ignore */ m.mines)) as MinesM;
      return M.liveMines(window.__cinder!.sim.state, at, 600).map((x) => ({ id: x.id, site: x.site, pos: x.pos }));
    },
    [MOD, layout.center] as const,
  );
  const ours = mines.filter((x) => x.site === site);
  expect(ours.length).toBe(6);
  ours.sort((a, b) => Math.min(...layout.sleepers.map((s) => Math.hypot(s.pos.x - b.pos.x, s.pos.y - b.pos.y))) - Math.min(...layout.sleepers.map((s) => Math.hypot(s.pos.x - a.pos.x, s.pos.y - a.pos.y))));
  const armed = ours[0]!;
  const radius = await page.evaluate(() => window.__cinder!.sim.state.player.props.boundingRadius);
  const out = (p: Vec, dist: number): Vec => {
    const d = Math.hypot(p.x - layout.center.x, p.y - layout.center.y) || 1;
    return { x: p.x + ((p.x - layout.center.x) / d) * dist, y: p.y + ((p.y - layout.center.y) / d) * dist };
  };
  // on screen, just outside the arming reach (12 u from the hull)
  const approach = out(armed.pos, radius + 17);
  await place(page, approach, Math.atan2(armed.pos.y - approach.y, armed.pos.x - approach.x));
  await settleCamera(page);
  await shot(page, 'graveyard-mine-radar');
  const close = out(armed.pos, radius + 7);
  await place(page, close, Math.atan2(armed.pos.y - close.y, armed.pos.x - close.x));
  await waitEvent(page, 'mineArmed', { id: armed.id }, 30_000);
  await waitFrames(page, 4);
  await shot(page, 'graveyard-mine-armed');
  await place(page, out(armed.pos, 45), 0);
  const hull0 = await hull(page);
  const blast = await waitEvent(page, 'mineExploded', { id: armed.id }, 30_000);
  expect(blast.id).toBe(armed.id);
  expect(await hull(page)).toBe(hull0);
  expect(
    await page.evaluate(
      async ([m, at, mid]) => ((await import(/* @vite-ignore */ m.mines)) as MinesM).liveMines(window.__cinder!.sim.state, at, 600).some((x) => x.id === mid),
      [MOD, layout.center, armed.id] as const,
    ),
  ).toBe(false);

  // a mine shot from range blows at once (it never arms)
  const target = ours[1]!;
  // from range (outside the arming reach, still on screen at the game camera)
  const range = out(target.pos, radius + 16);
  // the fixture ship's cannons are partly covered by its own hull: turn so the mine lies in a free arc
  const arcMid = await page.evaluate(() => {
    const w = window.__cinder!.sim.state.player.props.weapons.find((x) => x.arcs.length > 0)!;
    const facing = Math.atan2(w.facing.y, w.facing.x);
    return facing + (w.arcs[0]![0] + w.arcs[0]![1]) / 2;
  });
  await place(page, range, Math.atan2(target.pos.y - range.y, target.pos.x - range.x) - arcMid);
  await keepCharged(page);
  await aimAt(page, target.pos);
  await page.mouse.down({ button: 'left' });
  try {
    await waitEvent(page, 'mineExploded', { id: target.id }, 30_000);
  } finally {
    await page.mouse.up({ button: 'left' });
  }
  expect((await recorded(page, 'mineArmed')).some((e) => e.id === target.id)).toBe(false);
  await shot(page, 'graveyard-mine-shot');

  // the sleeping party wakes (a blast within its reach or the ship coming close) – radio, attack
  if ((await recorded(page, 'sleepersWoke')).length === 0) {
    const s = layout.sleepers[0]!;
    const p = out(s.pos, 45);
    await place(page, p, Math.atan2(s.pos.y - p.y, s.pos.x - p.x));
  }
  const woke = await waitEvent(page, 'sleepersWoke', { id: site }, 30_000);
  expect(woke.id).toBe(site);
  await page.waitForFunction(() => window.__cinder!.sim.state.combat.enemies.filter((e) => e.id.startsWith('gs:')).every((e) => e.ai.mode !== 'dormant'), undefined, { timeout: 30_000 });
  expect((await recorded(page, 'sleepersWoke')).length).toBe(1);
  await page.waitForTimeout(600);
  const sleepersText = await texts(page, 'sk', (t) => t.world.toasts.sleepersWoke);
  const toast = (await page.getByTestId('toast').textContent().catch(() => '')) ?? '';
  expect((await radio(page)).length > 0 || toast.includes(sleepersText)).toBe(true);
  await shot(page, 'graveyard-sleepers-woke');

  // the map: the graveyard and the derelict next to it in the legend and the places layer
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  await expect(page.getByTestId('map-legend')).toContainText(await texts(page, 'sk', (t) => t.world.map.graveyard));
  await page.waitForTimeout(400);
  await shot(page, 'graveyard-map');
  await page.keyboard.press('KeyM');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Gunner

test('Gunner: the cannons charge up before each salvo, it keeps its distance and evades when chased', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await start(page, 'gunner');
  const gunnerId = await page.evaluate(() => window.__cinder!.sim.state.combat.enemies.find((e) => e.kind === 'gunner')!.id);
  // the Gunner in front of the ship, inside its cannon reach (T2: 100 u) and on screen (to the right)
  await page.evaluate((gid) => {
    const s = window.__cinder!.sim.state;
    const p = s.player;
    const g = s.combat.enemies.find((e) => e.id === gid)!;
    const ship = { pos: { ...p.body.pos }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    p.body = ship;
    p.prevBody = ship;
    const body = { ...g.body, pos: { x: ship.pos.x + 52, y: ship.pos.y }, vel: { x: 0, y: 0 }, angle: Math.PI };
    g.body = body;
    g.prevBody = body;
    g.ai.mode = 'attack';
  }, gunnerId);

  // its standoff (90 u) is wider than the flight view: zoom out a little and hold it at 52 u (outside its
  // evade reach) so the tell is on screen
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 1200);
  await page.waitForFunction(() => (window.__cinder!.renderer as unknown as { enemyMarkerStats(): { viewDistance: number } }).enemyMarkerStats().viewDistance > 65, undefined, { timeout: 30_000 });

  /** The tell the renderer draws now (charge 0..1 before the salvo, firing in the salvo window). */
  const tell = () =>
    page.evaluate(
      async ([m, gid]) => {
        const Lk = (await import(/* @vite-ignore */ m.looks)) as LooksM;
        const s = window.__cinder!.sim.state;
        const g = s.combat.enemies.find((e) => e.id === gid);
        if (!g) return null;
        const p = s.player.body.pos;
        const d = Math.hypot(g.body.pos.x - p.x, g.body.pos.y - p.y);
        const t = Lk.salvoTell(g, d < (g.props.weapons[0]?.range ?? 0), 0);
        return { ...t, d, mode: g.ai.mode, tick: s.tick };
      },
      [MOD, gunnerId] as const,
    );
  // every frame (in the page): keep the ship whole and the Gunner where the camera sees it (its standoff
  // orbit would carry it off screen; the salvo clock runs on regardless); once the cannons are charged
  // almost full the game pauses, so the screenshot shows the tell and not the salvo after it
  await page.evaluate(async (m: Modules) => {
    (window as unknown as { __looks: LooksM }).__looks = (await import(/* @vite-ignore */ m.looks)) as LooksM;
  }, MOD);
  const charged = await page.waitForFunction(
    (gid) => {
      const Lk = (window as unknown as { __looks: LooksM }).__looks;
      const s = window.__cinder!.sim.state;
      const p = s.player;
      p.shield = p.props.shield.capacity;
      const g = s.combat.enemies.find((e) => e.id === gid);
      if (!g) return null;
      const body = { ...g.body, pos: { x: p.body.pos.x + 52, y: p.body.pos.y }, vel: { x: 0, y: 0 } };
      g.body = body;
      g.prevBody = body;
      const t = Lk.salvoTell(g, true, 0);
      if (t.charge <= 0.8 || t.firing) return null;
      (window.__cinder!.game as unknown as { setPaused(on: boolean): void }).setPaused(true);
      return { charge: t.charge, mode: g.ai.mode };
    },
    gunnerId,
    { timeout: 60_000 },
  );
  expect(((await charged.jsonValue()) as { charge: number }).charge).toBeGreaterThan(0.8);
  // the paused scene redraws now and then: let it draw the frozen tell
  await page.waitForTimeout(1500);
  const onScreen = await page.evaluate((gid) => window.__cinder!.renderer.worldToScreen(window.__cinder!.sim.state.combat.enemies.find((e) => e.id === gid)!.body.pos), gunnerId);
  expect(onScreen.x > 0 && onScreen.x < 1280 && onScreen.y > 0 && onScreen.y < 720, `gunner on screen at ${Math.round(onScreen.x)}, ${Math.round(onScreen.y)}`).toBe(true);
  await shot(page, 'gunner-salvo-tell');
  await page.evaluate(() => (window.__cinder!.game as unknown as { setPaused(on: boolean): void }).setPaused(false));
  // the salvo follows the tell: the Gunner's bolts fly
  await page.waitForFunction((gid) => window.__cinder!.sim.state.combat.projectiles.some((p) => p.owner === gid), gunnerId, { timeout: 30_000 });
  await waitFrames(page, 2);
  await shot(page, 'gunner-salvo');

  // standoff: it holds its distance from a stopped ship (sampled), never closing in
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    await waitTicks(page, 30);
    const t = await tell();
    if (t) samples.push(t.d);
  }
  expect(Math.min(...samples)).toBeGreaterThan(45);
  // chased: within half its standoff it breaks away (evade)
  await page.evaluate((gid) => {
    const s = window.__cinder!.sim.state;
    const g = s.combat.enemies.find((e) => e.id === gid)!;
    const p = s.player;
    const dx = p.body.pos.x - g.body.pos.x;
    const dy = p.body.pos.y - g.body.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const body = { pos: { x: g.body.pos.x + (dx / d) * 30, y: g.body.pos.y + (dy / d) * 30 }, vel: { x: 0, y: 0 }, angle: Math.atan2(-dy, -dx), angVel: 0 };
    p.body = body;
    p.prevBody = body;
  }, gunnerId);
  await page.waitForFunction((gid) => window.__cinder!.sim.state.combat.enemies.find((e) => e.id === gid)?.ai.mode === 'evade', gunnerId, { timeout: 30_000 });
  const d0 = (await tell())!.d;
  await waitTicks(page, 90);
  expect((await tell())!.d).toBeGreaterThan(d0);
  await shot(page, 'gunner-evade');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// language

test('SK → EN live with the event chip and the terminal open', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await start(page, 'derelict-dock');
  const id = 'dl:9,16';
  const req = await page.evaluate(() => window.__cinder!.events!.force('micrometeors'));
  await waitEvent(page, 'actionResult', { reqId: req });
  await waitEvent(page, 'eventWarning', { kind: 'micrometeors' });
  await page.waitForFunction((d) => window.__cinder!.berth!.candidate()?.id === d && window.__cinder!.berth!.candidate()?.status === 'ok', id, { timeout: 30_000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction((d) => window.__cinder!.berth!.id() === d, id, { timeout: 30_000 });
  const terminal = page.getByTestId('derelict-terminal');
  await expect(terminal).toBeVisible({ timeout: 30_000 });
  const chip = page.getByTestId('event-chip-micrometeors');
  const [sk, en] = await Promise.all([
    texts(page, 'sk', (t) => ({ chip: t.world.events.names.micrometeors, leave: t.world.derelict.terminal.leave, title: t.world.derelict.terminal.title })),
    texts(page, 'en', (t) => ({ chip: t.world.events.names.micrometeors, leave: t.world.derelict.terminal.leave, title: t.world.derelict.terminal.title })),
  ]);
  await expect(terminal.getByTestId('terminal-leave')).toContainText(sk.leave);
  const chipShown = (await chip.count()) > 0 && (await chip.isVisible());
  if (chipShown) await expect(chip).toContainText(sk.chip);
  await page.waitForTimeout(400);
  await shot(page, 'terminal-chip-sk');

  await page.evaluate(async (path) => ((await import(/* @vite-ignore */ path)) as LocaleM).setLocale('en'), MOD.locale);
  await expect(terminal.getByTestId('terminal-leave')).toContainText(en.leave, { timeout: 10_000 });
  await expect(terminal).toContainText(en.title);
  if (chipShown) await expect(chip).toContainText(en.chip, { timeout: 10_000 });
  await page.waitForTimeout(400);
  await shot(page, 'terminal-chip-en');

  // leave the berth: the flight HUD chip in English
  await page.getByTestId('terminal-leave').click();
  await expect(terminal).toBeHidden({ timeout: 30_000 });
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect(chip).toContainText(en.chip);
  await page.waitForTimeout(400);
  await shot(page, 'chip-en');
  await page.evaluate(async (path) => ((await import(/* @vite-ignore */ path)) as LocaleM).setLocale('sk'), MOD.locale);
  expect(errors).toEqual([]);
});

async function englishPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: 'en-GB', viewport: { width: 1280, height: 720 } });
  return context.newPage();
}

test('radio in English: the comet flyby and the derelict defence speak English', async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await englishPage(browser);
  const errors = await start(page, 'comet');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  const title = await texts(page, 'en', (t) => t.world.comet.name(4));
  await expect(page.getByTestId('event-chip-cometFlyby')).toContainText(title, { timeout: 30_000 });
  await page.waitForFunction(
    (t) => (window.__cinder!.game as unknown as { comms: { queue: { transcript: { lines: string[] }[] } } }).comms.queue.transcript.some((e) => e.lines.join(' ').includes(t)),
    title,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('comm-text')).toContainText(title, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await shot(page, 'comet-radio-en');
  // nothing Slovak on the air
  const sk = await texts(page, 'sk', (t) => t.world.comet.name(4));
  for (const l of await radio(page)) expect(l.text).not.toContain(sk);

  // a forced ambush: the chip, the pirates' contact and their toll hail in English
  const bucket = await hailBucket(page).catch(() => null);
  await page.evaluate(() => window.__cinder!.events!.force('ambush'));
  await waitEvent(page, 'eventWarning', { kind: 'ambush' });
  await expect(page.getByTestId('event-chip-ambush')).toContainText(await texts(page, 'en', (t) => t.world.events.names.ambush), { timeout: 30_000 });
  await waitEvent(page, 'ambushSpawned', {}, 30_000);
  await page.waitForTimeout(1500);
  await shot(page, 'ambush-radio-en');
  if (bucket !== null) {
    await page.evaluate(() => {
      const s = window.__cinder!.sim.state;
      const p = s.player.body.pos;
      s.combat.enemies
        .filter((e) => e.id.startsWith('ab:'))
        .forEach((e, i) => {
          const body = { ...e.body, pos: { x: p.x + 55 + i * 9, y: p.y + 12 - i * 7 }, vel: { x: 0, y: 0 } };
          e.body = body;
          e.prevBody = body;
        });
    });
    await waitEvent(page, 'tollDemanded', {}, 30_000);
    await expect(page.getByTestId('comm-panel').getByTestId('toll')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'ambush-toll-en');
  }
  expect(errors).toEqual([]);
  await page.context().close();
});
