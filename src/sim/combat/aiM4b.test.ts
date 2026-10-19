// M4b T6: the Gunner's standoff and evade, the derelict sentry's guard and the dormant graveyard sleeper –
// unit steps of `think` and seeded simulations in empty space.
import { describe, expect, it } from 'vitest';
import { GUNNER, SENTRY } from '../../data/pirates';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { clamp } from '../math/angle';
import { add, length, rotate, scale, sub, type Vec2 } from '../math/vec2';
import { createGrid } from '../ship/grid';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { AGGRO_RANGE, FLEE_HULL, gunnerStandoff, LEASH_RANGE, LOW_FUEL, makeDormant, steerTo, think, wakeEnemy } from './ai';
import { AIM_SKILL } from './aim';
import { createEnemy } from './enemies';
import type { AiMode, Enemy, EnemyKind } from './types';

const TICKS = 60;
const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

const enemy = (kind: EnemyKind, pos: Vec2 = { x: 0, y: 0 }, home: Vec2 = pos, id = `pr:t:${kind}`): Enemy =>
  createEnemy({ id, kind, tier: 1, pos, angle: 0, home, orbit: 1 });
const still = (x: number, y: number) => ({ pos: { x, y }, vel: { x: 0, y: 0 } });

/** The starter ship fitted for combat (2 cannons, shield, armour – balance.test.ts). */
const armedStarter = () =>
  createGrid([
    ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
    ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
    ['engine', 0, -2, 1], ['engine', 0, 2, 3], ['cannon', 1, 2, 0], ['cannon', 1, -2, 0], ['shield', -1, 2], ['armor', -1, -2],
  ]);

/** A sim in empty space with only the given enemies (the world's own pirates are kept out). */
function arena(seed = 77): Simulation {
  return new Simulation({ seed, startDocked: false, generator: emptySpace, grid: armedStarter() });
}

function step(sim: Simulation, ids: readonly string[], cmd: PlayerCommand = IDLE_COMMAND): SimEvent[] {
  sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => ids.includes(e.id));
  // keep the player alive and fuelled – the tests are about the AI, not the fight
  sim.state.player.hp = new Map();
  sim.state.player.fuel = sim.state.player.props.fuelCapacity;
  return sim.step(cmd);
}

/** Station keeping at `speed` u/s straight towards `to`, nose on it. */
function approach(sim: Simulation, to: Vec2, speed: number): PlayerCommand {
  const body = sim.state.player.body;
  const d = sub(to, body.pos);
  const want = scale(d, speed / Math.max(1e-6, length(d)));
  const err = rotate(sub(want, body.vel), -body.angle);
  return { ...IDLE_COMMAND, flight: { forward: clamp(err.x * 0.6, -1, 1), strafe: clamp(err.y * 0.6, -1, 1), turn: steerTo(body, to, 0).turn } };
}

describe('Gunner AI (M4b §2.6)', () => {
  it('stands off at 90 u (0.9 × its T2 cannon range) and notices the player at 180 u', () => {
    const g = enemy('gunner');
    expect(gunnerStandoff(g)).toBeCloseTo(90);
    expect(AGGRO_RANGE.gunner).toBe(GUNNER.aggroRange);
    expect(FLEE_HULL.gunner).toBe(GUNNER.fleeHull);
    const holder = { rng: 1 };
    expect(think(g, still(GUNNER.aggroRange + 5, 0), holder).alerted).toBe(false);
    expect(think(g, still(GUNNER.aggroRange - 5, 0), holder).alerted).toBe(true);
    expect(g.ai.mode).toBe('attack');
  }, 30_000);

  it('evades inside half its standoff: full thrust away and sideways, no fire, 4–6 s, then back to the attack', () => {
    const g = enemy('gunner');
    g.ai.mode = 'attack';
    g.body = { ...g.body, angle: Math.PI };
    const holder = { rng: 3 };
    const r = think(g, still(40, 0), holder);
    expect(g.ai.mode).toBe('evade');
    expect(r.cmd.fire).toBe(false);
    // the heading points away from the player (−x), bent to the side of its orbit
    expect(r.cmd.aim.x).toBeLessThan(0);
    expect(Math.abs(r.cmd.aim.y)).toBeGreaterThan(10);
    expect(g.ai.timer).toBeGreaterThanOrEqual(GUNNER.evadeSeconds[0] * TICKS - 1);
    expect(g.ai.timer).toBeLessThanOrEqual(GUNNER.evadeSeconds[1] * TICKS);
    const orbit = g.ai.orbit;
    let fired = 0;
    let steps = 1;
    while ((g.ai.mode as AiMode) === 'evade' && steps < 1000) {
      // the player stays put but out of the evade range
      if (think(g, still(70, 0), holder).cmd.fire) fired++;
      steps++;
    }
    expect(fired).toBe(0);
    expect(g.ai.mode).toBe('attack');
    expect(steps / TICKS).toBeGreaterThanOrEqual(GUNNER.evadeSeconds[0] - 0.05);
    expect(steps / TICKS).toBeLessThanOrEqual(GUNNER.evadeSeconds[1] + 0.05);
    // it comes back around the other way and has to find the target again before it fires
    expect(g.ai.orbit).toBe(-orbit);
    expect(g.ai.react).toBeGreaterThan(0);
  }, 30_000);

  it('flees below 35 % hull and gives up beyond the leash', () => {
    const g = enemy('gunner');
    g.ai.mode = 'attack';
    for (const p of g.grid.parts) if (p.partId !== 'cockpit' && p.partId !== 'cannon') g.hp.set(p.id, 1);
    think(g, still(90, 0), { rng: 4 });
    expect(g.ai.mode).toBe('flee');
    const h = enemy('gunner');
    h.ai.mode = 'evade';
    think(h, still(LEASH_RANGE + 1, 0), { rng: 4 });
    expect(h.ai.mode).toBe('patrol');
  }, 30_000);

  it('a Gunner without cannons keeps away', () => {
    const g = enemy('gunner');
    g.ai.mode = 'attack';
    g.props = { ...g.props, weapons: [] };
    expect(think(g, still(90, 0), { rng: 5 }).cmd.fire).toBe(false);
    expect(g.ai.mode).toBe('flee');
  }, 30_000);

  it('holds the standoff band against a parked player and fires salvos', () => {
    for (const bearing of [0, 2, 5]) {
      const sim = arena(80 + bearing);
      const p = sim.state.player.body.pos;
      const g = enemy('gunner', add(p, rotate({ x: 150, y: 0 }, (bearing / 8) * Math.PI * 2)));
      sim.state.combat.enemies.push(g);
      let shots = 0;
      const band: number[] = [];
      for (let t = 0; t < 40 * TICKS; t++) {
        for (const e of step(sim, [g.id])) if (e.type === 'shotFired' && e.owner === g.id) shots++;
        if (t > 15 * TICKS) band.push(length(sub(g.body.pos, sim.state.player.body.pos)));
      }
      expect(Math.min(...band)).toBeGreaterThan(gunnerStandoff(g) - 10);
      expect(Math.max(...band)).toBeLessThan(gunnerStandoff(g) + 10);
      // salvos: two volleys of 3 cannons every 2.6 s – well under the full rate (3 × 3 shots/s)
      expect(shots).toBeGreaterThan(40);
      expect(shots).toBeLessThan(40 * 9 * 0.5);
    }
  }, 30_000);

  it('keeps its distance from a slowly chasing player without breaking into an evade', () => {
    const sim = arena(91);
    const p = sim.state.player.body.pos;
    const g = enemy('gunner', add(p, { x: 120, y: 0 }));
    sim.state.combat.enemies.push(g);
    const band: number[] = [];
    let evaded = false;
    for (let t = 0; t < 40 * TICKS; t++) {
      step(sim, [g.id], approach(sim, g.body.pos, 6));
      if (g.ai.mode === 'evade') evaded = true;
      if (t > 15 * TICKS) band.push(length(sub(g.body.pos, sim.state.player.body.pos)));
    }
    expect(evaded).toBe(false);
    expect(Math.min(...band)).toBeGreaterThan(gunnerStandoff(g) - 15);
    expect(Math.max(...band)).toBeLessThan(gunnerStandoff(g) + 15);
  }, 30_000);

  it('a hard chase closes in: the Gunner evades, then turns back to its standoff', () => {
    const sim = arena(92);
    const p = sim.state.player.body.pos;
    const g = enemy('gunner', add(p, { x: 120, y: 0 }));
    sim.state.combat.enemies.push(g);
    const modes: string[] = [];
    for (let t = 0; t < 40 * TICKS; t++) {
      step(sim, [g.id], approach(sim, g.body.pos, 30));
      if (modes[modes.length - 1] !== g.ai.mode) modes.push(g.ai.mode);
    }
    expect(modes).toContain('evade');
    expect(modes.slice(modes.indexOf('evade'))).toContain('attack');
  }, 30_000);
});

describe('sentry AI (M4b §2.4)', () => {
  /** A sentry posted 30 u off its derelict at `home`. */
  function posted(sim: Simulation, home: Vec2): Enemy {
    const s = createEnemy({ id: 'dd:9,9:0', kind: 'sentry', tier: 1, pos: add(home, { x: 0, y: 30 }), angle: 0, home, orbit: 1 });
    sim.state.combat.enemies.push(s);
    return s;
  }

  it('waits at its post while the player is outside the guard radius, attacks inside it', () => {
    const sim = arena(93);
    const p = sim.state.player.body.pos;
    const home = add(p, { x: SENTRY.guardRadius + 30, y: 0 });
    const s = posted(sim, home);
    const post = { ...s.body.pos };
    let events: SimEvent[] = [];
    for (let t = 0; t < 5 * TICKS; t++) events.push(...step(sim, [s.id]));
    expect(s.ai.mode).toBe('patrol');
    expect(length(sub(s.body.pos, post))).toBeLessThan(1);
    expect(events.filter((e) => e.type === 'enemyAlert')).toHaveLength(0);
    // the player crosses into the guard radius (the sentry's own aggro distance does not matter)
    sim.state.player.body = { ...sim.state.player.body, pos: add(home, { x: -(SENTRY.guardRadius - 20), y: 0 }) };
    events = [];
    for (let t = 0; t < 10 * TICKS; t++) {
      events.push(...step(sim, [s.id]));
    }
    expect(events.filter((e) => e.type === 'enemyAlert')).toHaveLength(1);
    expect(s.ai.mode).toBe('attack');
    expect(events.some((e) => e.type === 'shotFired' && e.owner === s.id)).toBe(true);
  }, 30_000);

  it('never strays beyond its leash, never flees, burns no fuel, and returns to its post when the player leaves', () => {
    const sim = arena(94);
    const p = sim.state.player.body.pos;
    const home = add(p, { x: 120, y: 0 });
    const s = posted(sim, home);
    const fuel = s.fuel;
    let farthest = 0;
    let edgeShots = 0;
    for (let t = 0; t < 30 * TICKS; t++) {
      // the player comes into the guard radius, then backs off to just inside the leash – the sentry
      // follows only as far as its leash
      const off = t < 2 * TICKS ? SENTRY.guardRadius - 40 : SENTRY.leash - 5;
      sim.state.player.body = { ...sim.state.player.body, pos: add(home, { x: -off, y: 0 }), vel: { x: 0, y: 0 } };
      for (const e of step(sim, [s.id])) if (t > 20 * TICKS && e.type === 'shotFired' && e.owner === s.id) edgeShots++;
      farthest = Math.max(farthest, length(sub(s.body.pos, home)));
      if (t === 10 * TICKS) for (const part of s.grid.parts) if (part.partId !== 'cockpit') s.hp.set(part.id, 1);
    }
    expect(s.ai.mode).toBe('attack');
    expect(farthest).toBeLessThanOrEqual(SENTRY.leash);
    // at the edge of its leash it holds still like a turret and keeps shooting
    expect(edgeShots).toBeGreaterThan(0);
    expect(s.fuel).toBe(fuel);
    // low tanks do not send it home either
    s.fuel = s.props.fuelCapacity * LOW_FUEL * 0.5;
    step(sim, [s.id]);
    expect(s.ai.mode).toBe('attack');
    // the player leaves the leash: back to the post
    sim.state.player.body = { ...sim.state.player.body, pos: add(home, { x: -(SENTRY.leash + 100), y: 0 }) };
    for (let t = 0; t < 40 * TICKS; t++) step(sim, [s.id]);
    expect(s.ai.mode).toBe('patrol');
    expect(length(sub(s.body.pos, s.ai.waypoint))).toBeLessThan(6);
  }, 30_000);
});

describe('dormant sleepers (M4b §2.5)', () => {
  it('a dormant ship neither moves nor fires nor notices the player; its shield stays down', () => {
    const sim = arena(95);
    const p = sim.state.player.body.pos;
    const sleepers = (['hammer', 'jackal', 'gunner'] as const).map((kind, i) => makeDormant(enemy(kind, add(p, { x: 20 + 15 * i, y: 5 }), undefined, `gs:1,1:${i}`)));
    sim.state.combat.enemies.push(...sleepers);
    const start = sleepers.map((e) => ({ ...e.body.pos }));
    const events: SimEvent[] = [];
    for (let t = 0; t < 20 * TICKS; t++) events.push(...step(sim, sleepers.map((e) => e.id)));
    sleepers.forEach((e, i) => {
      expect(e.ai.mode).toBe('dormant');
      expect(length(sub(e.body.pos, start[i]!))).toBeLessThan(1e-9);
      expect(e.shield).toBe(0);
    });
    expect(events.filter((e) => e.type === 'shotFired' && e.owner !== 'player')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'enemyAlert')).toHaveLength(0);
  }, 30_000);

  it('wakes into an attack (once); its shield charges and it fires after its reaction time', () => {
    const sim = arena(96);
    const p = sim.state.player.body.pos;
    const h = makeDormant(enemy('hammer', add(p, { x: 30, y: 0 }), undefined, 'gs:2,2:0'));
    sim.state.combat.enemies.push(h);
    for (let t = 0; t < TICKS; t++) step(sim, [h.id]);
    expect(wakeEnemy(h, AIM_SKILL.mild)).toBe(true);
    expect(wakeEnemy(h)).toBe(false);
    expect(h.ai.mode).toBe('attack');
    expect(h.ai.react).toBe(AIM_SKILL.mild.reaction);
    let shots = 0;
    for (let t = 0; t < 10 * TICKS; t++) for (const e of step(sim, [h.id])) if (e.type === 'shotFired' && e.owner === h.id) shots++;
    expect(shots).toBeGreaterThan(0);
    expect(h.shield).toBeGreaterThan(0);
  }, 30_000);
});
