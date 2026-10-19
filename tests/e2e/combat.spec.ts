import { expect, test } from './test';
import type { Page } from '@playwright/test';

/** Where the screenshots go (test-results/ by default, another directory when debugging). */
const SHOTS = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.M3A_SHOT_DIR ?? 'test-results';

/** Game modules from the dev server (Vite) – the same instances as in the game. */
const MODULES = { grid: '/src/sim/ship/grid.ts', properties: '/src/sim/ship/properties.ts', enemies: '/src/sim/combat/enemies.ts' } as const;
type GridModule = typeof import('../../src/sim/ship/grid');
type PropertiesModule = typeof import('../../src/sim/ship/properties');
type EnemiesModule = typeof import('../../src/sim/combat/enemies');

/** Waits until the simulation has run at least `ticks` steps (independent of the browser's speed). */
async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  try {
    await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 60_000 });
  } catch (e) {
    const s = await page.evaluate(() => {
      const st = window.__cinder!.sim.state;
      return { tick: st.tick, destroyed: st.player.destroyed, dock: st.player.dock.mode, parts: st.player.grid.parts.length, enemies: st.combat.enemies.map((x) => [x.id, x.grid.parts.length, x.shield]) };
    });
    throw new Error(`simulation stalled: ${JSON.stringify(s)} – ${String(e)}`);
  }
}

/** The player's combat ship (starter + 2 cannons + shield) in ring 2 – through the dev server's modules. */
async function setupFighter(page: Page, pos: { x: number; y: number }, clear = true): Promise<void> {
  await page.evaluate(async ({ p, modules, clear }) => {
    const { createGrid } = (await import(/* @vite-ignore */ modules.grid)) as GridModule;
    const { computeProperties } = (await import(/* @vite-ignore */ modules.properties)) as PropertiesModule;
    const { sim } = window.__cinder!;
    const player = sim.state.player;
    const grid = createGrid([
      ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
      ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
      ['engine', 0, -2, 1], ['engine', 0, 2, 3], ['cannon', 1, 2, 0], ['cannon', 1, -2, 0], ['shield', -1, 2], ['armor', -1, -2],
    ]);
    const props = computeProperties(grid);
    player.grid = grid;
    player.props = props;
    player.gridVersion++;
    player.hp = new Map();
    player.energy = props.batteryCapacity;
    player.shield = props.shield.capacity;
    player.fuel = props.fuelCapacity;
    const body = { pos: p, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    player.body = body;
    player.prevBody = body;
    if (clear) {
      sim.state.combat.enemies = [];
      sim.state.combat.projectiles = [];
    }
  }, { p: pos, modules: MODULES, clear });
}

/**
 * Pirate at the given spot at full strength; `frozen` = no engines (it stands, but fires). Its props
 * are recomputed when it loses a part, so a damaged pirate gets its engines back.
 */
async function spawnPirate(page: Page, kind: 'jackal' | 'hammer', pos: { x: number; y: number }, angle: number, frozen: boolean): Promise<string> {
  return page.evaluate(
    async ({ kind, pos, angle, frozen, modules }) => {
      const { createEnemy } = (await import(/* @vite-ignore */ modules.enemies)) as EnemiesModule;
      const { sim } = window.__cinder!;
      const e = createEnemy({ id: `pr:e2e:${kind}`, kind, tier: 1, pos, angle, home: pos, orbit: 1 });
      if (frozen) e.props = { ...e.props, thrust: { forward: 0, backward: 0, left: 0, right: 0 }, torque: 0 };
      e.ai.mode = 'attack';
      sim.state.combat.enemies.push(e);
      return e.id;
    },
    { kind, pos, angle, frozen, modules: MODULES },
  );
}

/**
 * Removes the pirates the world spawned around the arena (ambient groups, a Scavenger that would fly
 * off with the wreck) and keeps their slots empty – the duel is the test's own.
 */
async function clearAmbientPirates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { combat, tick } = window.__cinder!.sim.state;
    for (const e of combat.enemies) if (!e.id.startsWith('pr:e2e:')) combat.defeated.set(e.id, tick);
    combat.enemies = combat.enemies.filter((e) => e.id.startsWith('pr:e2e:'));
  });
}

/** State of the test pirate for assertion messages. */
const pirateState = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { sim } = window.__cinder!;
    const e = sim.state.combat.enemies.find((x) => x.id === id);
    return {
      tick: sim.state.tick,
      alive: !!e,
      parts: e?.grid.parts.length,
      cannons: e?.props.weapons.length,
      shield: e?.shield,
      mode: e?.ai.mode,
      kills: sim.state.stats.kills,
      playerDestroyed: sim.state.player.destroyed,
    };
  }, id);

async function aimAt(page: Page, p: { x: number; y: number }): Promise<void> {
  const screen = await page.evaluate((q) => window.__cinder!.renderer.worldToScreen(q), p);
  await page.mouse.move(screen.x, screen.y);
}

/** Slows down the combat effects (look only) – explosion screenshots independent of the browser's speed. */
const fxTime = (page: Page, scale: number) =>
  page.evaluate((s) => {
    (window.__cinder!.renderer as unknown as { combat: { timeScale: number } }).combat.timeScale = s;
  }, scale);

const hideUi = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    document.getElementById('ui')!.style.display = h ? 'none' : '';
  }, hidden);

test('M3a: fight a pirate, see shield hits, explosion, wreck and salvage', async ({ page }) => {
  // the shots aim by screen position – a shaking camera (M3.8) would move the aim point
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ v: 1, cameraShake: false, combatZoom: false })));
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));

  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');

  // ring 2, empty space far from the stations
  const base = { x: 2400, y: -1300 };
  await setupFighter(page, base);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 250);
  // one spawn check (every 30 ticks) has run – then the arena is emptied of the world's pirates
  await waitTicks(page, 30);
  await clearAmbientPirates(page);

  // --- fight: the frozen Hammer (with a shield) shoots the player, the player shoots back
  const hammerPos = { x: base.x + 19, y: base.y + 3 };
  const hammer = await spawnPirate(page, 'hammer', hammerPos, Math.PI, true);
  await aimAt(page, hammerPos);
  await page.mouse.down({ button: 'left' });
  // the camera is still settling – re-aim until both sides have fired. A fired cannon stays on its
  // cooldown for the whole reload (20 ticks), so this sees every volley however rarely it polls; the
  // projectiles themselves cross the 19 u gap in ~10 ticks and the two sides fire out of phase, so
  // waiting for both sides' projectiles in flight at once could miss every volley.
  const firing = (id: string) =>
    page.evaluate((id) => {
      const { sim } = window.__cinder!;
      const e = sim.state.combat.enemies.find((x) => x.id === id);
      return { player: sim.state.player.cooldowns.size > 0, pirate: (e?.cooldowns.size ?? 0) > 0, tick: sim.state.tick };
    }, id);
  const start = await page.evaluate(() => window.__cinder!.sim.state.tick);
  let fire = await firing(hammer);
  while (!(fire.player && fire.pirate) && fire.tick - start < 600) {
    await aimAt(page, hammerPos);
    await waitTicks(page, 4);
    fire = await firing(hammer);
  }
  expect(fire, JSON.stringify(await pirateState(page, hammer))).toMatchObject({ player: true, pirate: true });
  // screenshot while shots fly between the ships
  await hideUi(page, true);
  await page.waitForFunction(
    () => {
      const { sim } = window.__cinder!;
      const ships = [sim.state.player.body.pos, ...sim.state.combat.enemies.map((e) => e.body.pos)];
      return sim.state.combat.projectiles.filter((p) => ships.every((s) => Math.hypot(s.x - p.pos.x, s.y - p.pos.y) > 5)).length >= 2;
    },
    undefined,
    { timeout: 60_000, polling: 'raf' },
  );
  await page.screenshot({ path: `${SHOTS}/m3a-fight.png` });
  // hold fire: the next stage is about the pirate's hits on the player's shield, and the player's own
  // volleys would wear the pirate's cannons down meanwhile
  await page.mouse.up({ button: 'left' });
  const armed = await pirateState(page, hammer);
  expect(armed.alive && (armed.cannons ?? 0) > 0, JSON.stringify(armed)).toBe(true);

  // the player's shield has just taken a hit (the regen delay was just set, the shield still holds).
  // A slow software renderer runs several ticks per frame, so the frame right after a hit can be missed:
  // catch any hit within its first 20 ticks (the hit flash runs at 0.15× speed), and top the shield up
  // again whenever a missed hit has drained it, or the pirate's volleys would empty it for good.
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.shield = p.props.shield.capacity;
    p.shieldDelay = 0;
  });
  await fxTime(page, 0.15);
  await page.waitForFunction(
    () => {
      const p = window.__cinder!.sim.state.player;
      const delay = Math.round(p.props.shield.regenDelay * 60);
      if (p.shield > 0 && p.shieldDelay > 0 && p.shieldDelay >= delay - 20) return true;
      if (p.shield < p.props.shield.capacity / 2) p.shield = p.props.shield.capacity;
      return false;
    },
    undefined,
    { timeout: 60_000, polling: 'raf' },
  );
  await page.screenshot({ path: `${SHOTS}/m3a-shield.png` });
  await fxTime(page, 1);
  await hideUi(page, false);

  // finishing off: the player with a new ship (cannons may have fallen off), the Hammer with an almost destroyed cockpit,
  // no shield and recharging cannons; the player turns towards it
  const beforeKill = await pirateState(page, hammer);
  expect(beforeKill.alive, JSON.stringify(beforeKill)).toBe(true);
  const here = await page.evaluate(() => window.__cinder!.sim.state.player.body.pos);
  await setupFighter(page, here, false);
  await clearAmbientPirates(page);
  await page.evaluate((id) => {
    const e = window.__cinder!.sim.state.combat.enemies.find((x) => x.id === id)!;
    // a short finish: every part on at most 10 HP, the cockpit and the armour in front of it on 1
    for (const p of e.grid.parts) e.hp.set(p.id, Math.min(e.hp.get(p.id) ?? 10, 10));
    const cockpit = e.grid.parts.find((p) => p.partId === 'cockpit')!;
    e.hp.set(cockpit.id, 1);
    for (const p of e.grid.parts) if (p.partId === 'armor') e.hp.set(p.id, 1);
    e.shield = 0;
    e.props = { ...e.props, shield: { ...e.props.shield, capacity: 0 }, thrust: { forward: 0, backward: 0, left: 0, right: 0 } };
  }, hammer);
  await page.mouse.down({ button: 'left' });
  // the Hammer goes down – explosion (effects slowed so the screenshot catches the fire phase)
  await fxTime(page, 0.08);
  for (let i = 0; i < 200; i++) {
    const alive = await page.evaluate((id) => window.__cinder!.sim.state.combat.enemies.some((e) => e.id === id), hammer);
    if (!alive) break;
    // aims at the current position (after losing parts the Hammer sets off again)
    const at = await page.evaluate((id) => {
      const { sim } = window.__cinder!;
      const e = sim.state.combat.enemies.find((x) => x.id === id);
      if (!e) return null;
      for (const w of e.props.weapons) e.cooldowns.set(w.partId, 100000);
      const p = sim.state.player;
      p.energy = p.props.batteryCapacity;
      const angle = Math.atan2(e.body.pos.y - p.body.pos.y, e.body.pos.x - p.body.pos.x);
      p.body = { ...p.body, angle, angVel: 0 };
      p.prevBody = p.body;
      return e.body.pos;
    }, hammer);
    if (at) await aimAt(page, at);
    await waitTicks(page, 6);
  }
  const fight = await page.evaluate((id) => {
    const { sim } = window.__cinder!;
    const e = sim.state.combat.enemies.find((x) => x.id === id);
    return { alive: !!e, parts: e?.grid.parts.length, shield: e?.shield, player: sim.state.player.destroyed, energy: sim.state.player.energy, tick: sim.state.tick };
  }, hammer);
  expect(fight.alive, JSON.stringify(fight)).toBe(false);
  await page.mouse.up({ button: 'left' });
  await hideUi(page, true);
  await page.screenshot({ path: `${SHOTS}/m3a-explosion.png` });
  await fxTime(page, 0.3);
  await waitTicks(page, 8);
  await page.screenshot({ path: `${SHOTS}/m3a-explosion-fire.png` });
  await fxTime(page, 0.4);
  await waitTicks(page, 40);
  await page.screenshot({ path: `${SHOTS}/m3a-explosion-late.png` });
  await fxTime(page, 1);
  await hideUi(page, false);

  const after = await page.evaluate(() => {
    const { sim, renderer } = window.__cinder!;
    return {
      kills: sim.state.stats.kills,
      wrecks: sim.state.combat.wrecks.length,
      loot: sim.state.combat.wrecks.some((w) => w.loot.cargo.iron > 0),
      layer: renderer.combatStats(),
      destroyed: sim.state.player.destroyed,
    };
  });
  expect(after.kills).toBe(1);
  expect(after.wrecks).toBeGreaterThan(0);
  expect(after.loot).toBe(true);
  expect(after.layer.wrecks).toBe(after.wrecks);
  expect(after.destroyed).toBe(false);

  // --- loot: to the wreck with loot and F
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const w = sim.state.combat.wrecks.find((x) => x.loot.cargo.iron > 0)!;
    const p = sim.state.player;
    const pos = { x: w.body.pos.x - w.props.boundingRadius - p.props.boundingRadius - 2, y: w.body.pos.y };
    const body = { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    p.body = body;
    p.prevBody = body;
    for (const x of sim.state.combat.wrecks) x.body = { ...x.body, vel: { x: 0, y: 0 }, angVel: 0 };
  });
  await waitTicks(page, 20);
  await hideUi(page, true);
  await page.screenshot({ path: `${SHOTS}/m3a-wreck.png` });
  await hideUi(page, false);
  const ironBefore = await page.evaluate(() => window.__cinder!.sim.state.player.cargo.iron);
  await page.keyboard.press('KeyF');
  await page.waitForFunction((before) => window.__cinder!.sim.state.player.cargo.iron > before, ironBefore, { timeout: 30_000 });

  // --- engine: flame at full thrust, close up
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    sim.state.combat.wrecks = [];
    const p = sim.state.player;
    const body = { pos: { x: 2600, y: -1500 }, vel: { x: 0, y: 0 }, angle: 0.35, angVel: 0 };
    p.body = body;
    p.prevBody = body;
  });
  await page.mouse.wheel(0, -2000);
  await page.keyboard.down('KeyW');
  await waitTicks(page, 40);
  await hideUi(page, true);
  await page.screenshot({ path: `${SHOTS}/m3a-engine-flame.png` });
  await hideUi(page, false);
  await page.keyboard.up('KeyW');

  expect(errors).toEqual([]);
});

test('M3a: a mined-out asteroid breaks up into fragments', async ({ page }) => {
  // the shots aim by screen position – a shaking camera (M3.8) would move the aim point
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ v: 1, cameraShake: false, combatZoom: false })));
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');

  const target = await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const rocks = sim.state.world.circlesNear({ x: 75, y: 45 }, 40);
    const { asteroid, circle } = rocks.sort((a, b) => b.circle.radius - a.circle.radius)[0]!;
    // almost mined out – falls apart after a while of mining
    sim.state.world.extract(asteroid, sim.state.world.remaining(asteroid) - 1.5);
    const pos = { x: circle.pos.x - circle.radius - 7, y: circle.pos.y };
    const body = { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    return { pos: circle.pos, id: asteroid.id };
  });
  await waitTicks(page, 40);
  await aimAt(page, target.pos);
  await hideUi(page, true);
  await fxTime(page, 0.1);
  await page.mouse.down({ button: 'right' });
  for (let i = 0; i < 60; i++) {
    const done = await page.evaluate((id) => window.__cinder!.sim.state.world.remainingById.get(id) === 0, target.id);
    if (done) break;
    await aimAt(page, target.pos);
    await waitTicks(page, 6);
  }
  expect(await page.evaluate((id) => window.__cinder!.sim.state.world.remainingById.get(id), target.id)).toBe(0);
  await page.mouse.up({ button: 'right' });
  await fxTime(page, 0.6);
  await waitTicks(page, 4);
  await page.screenshot({ path: `${SHOTS}/m3a-asteroid-breakup.png` });
  await fxTime(page, 0.5);
  await waitTicks(page, 40);
  await page.screenshot({ path: `${SHOTS}/m3a-asteroid-breakup-late.png` });
  await fxTime(page, 1);
  await hideUi(page, false);
  expect(errors).toEqual([]);
});
