// Combat fairness: pirates fly by the player's rules (fuel, cargo mass, covered nozzles) and their
// gunnery follows the difficulty. M4b: the Gunner (standoff artillery) is beatable – a starter ship
// lasts, a T2 fighter kills it, it cannot kite a chasing ship and its fuel runs out like anyone's. M4c: a
// large reactor beside the cockpit is a risk, not a death sentence. M4d: the Guild Watch never makes a
// fight worse for the player (the side rules, npc/sides.ts – no friendly fire).
import { describe, expect, it, vi } from 'vitest';
import { GUNNER } from '../data/pirates';
import { PART_DEFS, type Tier } from '../data/parts';
import { cargoMass } from '../data/resources';
import { IDLE_COMMAND, type PlayerCommand } from './commands';
import { enemyFlight } from './combat/combat';
import { gunnerStandoff, LOW_FUEL, RESUME_FUEL, steerTo } from './combat/ai';
import { leadPoint } from './combat/weapons';
import { add, length, rotate, sub } from './math/vec2';
import { hullHp } from './ship/hp';
import { createEnemy, enemyMass } from './combat/enemies';
import type { Enemy, EnemyKind } from './combat/types';
import type { DeathPenalty } from './settings';
import { flightFuel, fuelNeeded } from './ship/fuel';
import { createGrid, validateGrid } from './ship/grid';
import { blastNeighbours } from './combat/partBlast';
import { EXHAUST_BURN_DPS } from './ship/exhaust';
import { Simulation, type SimEvent } from './Simulation';
import type { ChunkGenerator } from './world/generate';
import { scheduledWatchNear } from './guild';
import { sectorInfoAt, sectorLanes } from './regions';
import { securityHere } from './pirates/sectors';

/**
 * M4d: `guild.off` switches the Guild step off (no live Watch ships). Off by default: the pirate rules
 * above are measured alone (a lane patrol near home would otherwise join their fights); the Watch duel
 * below switches it on for its "with the Watch" runs.
 */
const guild = vi.hoisted(() => ({ off: true }));
vi.mock('./guild', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./guild')>();
  return { ...mod, stepGuild: (...args: Parameters<typeof mod.stepGuild>) => (guild.off ? undefined : mod.stepGuild(...args)) };
});

/** Empty space without stations and asteroids. */
const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

function flyingSim(grid?: ReturnType<typeof createGrid>, deathPenalty: DeathPenalty = 'mild'): Simulation {
  const sim = new Simulation({ seed: 77, startDocked: false, generator: emptySpace, settings: { deathPenalty }, ...(grid ? { grid } : {}) });
  return sim;
}

function addEnemy(sim: Simulation, kind: EnemyKind, pos: { x: number; y: number }, id = `pr:test:${kind}`): Enemy {
  const e = createEnemy({ id, kind, tier: 1, pos, angle: Math.PI, home: pos, orbit: 1 });
  sim.state.combat.enemies.push(e);
  return e;
}

const run = (sim: Simulation, steps: number, cmd: PlayerCommand = IDLE_COMMAND): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < steps; i++) out.push(...sim.step(cmd));
  return out;
};

describe('pirate fuel', () => {
  it('burns by the player’s rule (fuelNeeded × the engines’ fuel use) and stops at empty', () => {
    const sim = flyingSim();
    const e = addEnemy(sim, 'jackal', { x: 500, y: 0 });
    const before = e.fuel;
    const out = enemyFlight(sim.state, e, { flight: { forward: 1, strafe: 0, turn: 0 }, aim: { x: 0, y: 0 }, fire: false }, 1 / 60);
    expect(out.localForce.x).toBeCloseTo(e.props.thrust.forward);
    expect(before - e.fuel).toBeCloseTo(fuelNeeded(out.localForce, 1 / 60) * e.props.fuelUseMult);
  });

  it('with empty tanks only the gyros work: no thrust, no dampers, but it still turns', () => {
    const sim = flyingSim();
    const e = addEnemy(sim, 'jackal', { x: 500, y: 0 });
    e.fuel = 0;
    e.body = { ...e.body, vel: { x: 3, y: 0 } };
    const out = enemyFlight(sim.state, e, { flight: { forward: 1, strafe: 1, turn: 1 }, aim: { x: 0, y: 0 }, fire: false }, 1 / 60);
    expect(Math.hypot(out.force.x, out.force.y)).toBe(0);
    expect(out.torque).toBeGreaterThan(0);
    expect(e.fuel).toBe(0);
  });

  it('a pirate that lost its side engines brakes a drift with the cockpit RCS, by the player’s fuel rule', () => {
    const sim = flyingSim();
    const e = addEnemy(sim, 'jackal', { x: 500, y: 0 });
    e.props = { ...e.props, thrust: { ...e.props.thrust, left: 0, right: 0 } };
    // the jackal faces −x (angle π): a world drift along +y is a drift to its right
    e.body = { ...e.body, vel: { x: 0, y: 3 } };
    const before = e.fuel;
    const out = enemyFlight(sim.state, e, { flight: { forward: 0, strafe: 0, turn: 0 }, aim: { x: 0, y: 0 }, fire: false }, 1 / 60);
    expect(Math.abs(out.localForce.y)).toBeCloseTo(e.props.rcsThrust);
    expect(out.rcs.y).toBeCloseTo(out.localForce.y);
    expect(before - e.fuel).toBeCloseTo(flightFuel(out, e.props.fuelUseMult, 1 / 60));
  });

  it('a pirate low on fuel breaks off the attack and flies home', () => {
    const sim = flyingSim();
    const e = addEnemy(sim, 'jackal', { x: 40, y: 0 });
    e.home = { x: 300, y: 0 };
    run(sim, 30);
    expect(e.ai.mode).toBe('attack');
    e.fuel = e.props.fuelCapacity * 0.1;
    run(sim, 900);
    expect(e.ai.mode).toBe('retreat');
    expect(e.body.pos.x).toBeGreaterThan(100);
    expect(e.fuel).toBeGreaterThan(0);
  });

  it('I14: a patrol around home burns no fuel; a pirate home on low tanks refuels and patrols again', () => {
    const sim = flyingSim();
    const e = addEnemy(sim, 'hammer', { x: 400, y: 0 });
    const fuel = e.fuel;
    run(sim, 60 * 120);
    expect(sim.state.combat.enemies).toContain(e);
    expect(e.ai.mode).toBe('patrol');
    expect(e.fuel).toBe(fuel);
    // low tanks: retreat home, refuel there, back on patrol
    e.fuel = e.props.fuelCapacity * 0.1;
    run(sim, 60);
    expect(e.ai.mode).toBe('retreat');
    run(sim, 60 * 150);
    expect(sim.state.combat.enemies).toContain(e);
    expect(e.ai.mode).toBe('patrol');
    expect(e.fuel).toBeGreaterThanOrEqual(e.props.fuelCapacity * RESUME_FUEL - 1e-9);
  });

  it('hammer and scavenger carry a fuel tank, the jackal flies on its cockpit tank', () => {
    const sim = flyingSim();
    expect(addEnemy(sim, 'jackal', { x: 500, y: 0 }).props.fuelCapacity).toBe(PART_DEFS.cockpit[1].fuel);
    for (const kind of ['hammer', 'scavenger'] as const) {
      expect(addEnemy(sim, kind, { x: 500, y: 50 }).props.fuelCapacity).toBe(PART_DEFS.cockpit[1].fuel! + PART_DEFS.fuelTank[1].fuel!);
    }
  });
});

describe('scavenger cargo mass', () => {
  it('a laden scavenger is heavier and accelerates less, like the player with a full hold', () => {
    const sim = flyingSim();
    const light = addEnemy(sim, 'scavenger', { x: 500, y: 0 }, 'zb:a');
    const heavy = addEnemy(sim, 'scavenger', { x: 500, y: 100 }, 'zb:b');
    light.hold = { cargo: { iron: 0, copper: 0, ice: 0, titanium: 0 }, parts: {} };
    heavy.hold = { cargo: { iron: 120, copper: 0, ice: 0, titanium: 0 }, parts: {} };
    expect(enemyMass(heavy)).toBeCloseTo(heavy.props.mass + cargoMass(heavy.hold.cargo));
    expect(enemyMass(heavy)).toBeGreaterThan(enemyMass(light));
    // both flee at full thrust for a second
    for (const e of [light, heavy]) {
      e.ai.mode = 'flee';
      e.ai.timer = 600;
      e.body = { ...e.body, angle: 0 };
    }
    sim.state.player.body = { ...sim.state.player.body, pos: { x: 300, y: 50 } };
    run(sim, 60);
    const speed = (e: Enemy) => Math.hypot(e.body.vel.x, e.body.vel.y);
    expect(speed(heavy)).toBeLessThan(speed(light) * 0.95);
  });
});

describe('covered nozzle in flight', () => {
  it('an engine blowing into a part halves its thrust and burns the part 2 HP/s at full throttle', () => {
    const g = createGrid([
      ['cockpit', 1, 0],
      ['cargo', 0, 0],
      ['engine', 1, 1, 0],
      ['cargo', 0, 1],
      ['engine', 2, 0, 2],
      ['engine', 1, -1, 1],
      ['engine', 1, 2, 3],
    ]);
    const sim = flyingSim(g);
    const p = sim.state.player;
    expect(p.props.exhaustBurns).toEqual([{ engineId: 3, partId: 4, group: 'forward' }]);
    const hold = p.grid.parts.find((x) => x.id === 4)!;
    const max = PART_DEFS.cargo[1].hp;
    const events = run(sim, 60, { ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0 } });
    expect(p.hp.get(hold.id)).toBeCloseTo(max - EXHAUST_BURN_DPS, 1);
    expect(events.filter((e) => e.type === 'exhaustBurn')).toEqual([{ type: 'exhaustBurn', engineId: 3, partId: 4, key: 'cargo:1', hp: expect.any(Number) }]);
    // no thrust forward – no burn
    const hp = p.hp.get(hold.id)!;
    run(sim, 60, { ...IDLE_COMMAND, flight: { forward: 0, strafe: 0, turn: 0 }, toggleDampers: false });
    expect(p.hp.get(hold.id)).toBeCloseTo(hp, 5);
  });

  it('a part burnt through is lost like any destroyed part (cause: exhaust)', () => {
    const g = createGrid([
      ['cockpit', 1, 0],
      ['cargo', 0, 0],
      ['engine', 1, 1, 0],
      ['cargo', 0, 1],
      ['engine', 2, 0, 2],
    ]);
    const sim = flyingSim(g);
    const p = sim.state.player;
    p.hp.set(4, 0.02);
    const events = run(sim, 5, { ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0 } });
    expect(p.grid.parts.some((x) => x.id === 4)).toBe(false);
    expect(events.find((e) => e.type === 'partsLost')).toMatchObject({ cause: 'exhaust' });
  });
});

describe('pirate gunnery by difficulty', () => {
  /** Hits on a stationary player by one frozen Hammer 25 u away over 30 s. */
  function hits(deathPenalty: DeathPenalty): { shots: number; hits: number } {
    const sim = flyingSim(undefined, deathPenalty);
    const e = addEnemy(sim, 'hammer', { x: 25, y: 0 });
    e.props = { ...e.props, thrust: { forward: 0, backward: 0, left: 0, right: 0 } };
    e.ai.mode = 'attack';
    let shots = 0;
    let hit = 0;
    for (let i = 0; i < 30 * 60; i++) {
      // keep the player alive and untouched – only the aim is measured
      sim.state.player.hp = new Map();
      sim.state.player.shield = 0;
      for (const ev of sim.step(IDLE_COMMAND)) {
        if (ev.type === 'shotFired' && ev.owner === e.id) shots++;
        if (ev.type === 'projectileHit' && ev.owner === e.id && ev.ref === 'player') hit++;
      }
    }
    return { shots, hits: hit };
  }

  it('Calm misses noticeably more than Hardcore', () => {
    const calm = hits('none');
    const hardcore = hits('hardcore');
    expect(calm.shots).toBeGreaterThan(20);
    expect(hardcore.hits / hardcore.shots).toBeGreaterThan(0.9);
    expect(calm.hits / calm.shots).toBeLessThan(hardcore.hits / hardcore.shots - 0.15);
  });
});

// ---------------------------------------------------------------------------
// M4b: the Gunner

/** The starter ship with two cannons, a shield and armour (balance.test.ts). */
const armedStarter = () =>
  createGrid([
    ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
    ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
    ['engine', 0, -2, 1], ['engine', 0, 2, 3], ['cannon', 1, 2, 0], ['cannon', 1, -2, 0], ['shield', -1, 2], ['armor', -1, -2],
  ]);

/** The reference fighter of the balance tests (two forward cannons, shield, armour in front). */
const fighter = (tier: Tier) =>
  createGrid([
    ['cockpit', 0, 0, 0, tier], ['gyro', 0, 2, 0, tier], ['cannon', 1, 1, 0, tier], ['cannon', 1, -1, 0, tier], ['armor', 1, 0, 0, tier],
    ['reactor', -1, 0, 0, tier], ['shield', 0, 1, 0, tier], ['cargo', 0, -1, 0, tier], ['engine', -2, 0, 0, tier], ['engine', 2, 0, 2, tier],
    ['engine', -1, 1, 3, tier], ['engine', -1, -1, 1, tier],
  ]);

const GUNNER_ID = 'pr:gunner:0';

/** A Gunner (T1 hull, T2 cannons – a depth-3 group leader) 150 u from the player on bearing `variant` of 8. */
function gunnerDuel(grid: ReturnType<typeof createGrid>, deathPenalty: DeathPenalty, variant: number): { sim: Simulation; gunner: Enemy } {
  const sim = new Simulation({ seed: 300 + variant, startDocked: false, generator: emptySpace, settings: { deathPenalty }, grid });
  const a = (variant / 8) * Math.PI * 2;
  const pos = add(sim.state.player.body.pos, rotate({ x: 150, y: 0 }, a));
  const gunner = createEnemy({ id: GUNNER_ID, kind: 'gunner', tier: 1, pos, angle: a + Math.PI, home: pos, orbit: variant % 2 === 0 ? 1 : -1 });
  sim.state.combat.enemies = [gunner];
  return { sim, gunner };
}

const theGunner = (sim: Simulation): Enemy | undefined => {
  sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => e.id === GUNNER_ID);
  return sim.state.combat.enemies[0];
};

describe('Gunner fairness (M4b §2.6)', () => {
  it('the starter ship with 2 cannons and a shield lasts 40+ s against one Gunner without shooting back (Calm, Standard)', () => {
    for (const difficulty of ['none', 'mild'] as const) {
      for (let v = 0; v < 8; v++) {
        const { sim } = gunnerDuel(armedStarter(), difficulty, v);
        let t = 0;
        for (; t < 40 * 60; t++) {
          const g = theGunner(sim);
          if (!g || sim.state.player.destroyed) break;
          sim.state.player.fuel = sim.state.player.props.fuelCapacity;
          sim.step({ ...IDLE_COMMAND, flight: steerTo(sim.state.player.body, g.body.pos, 0) });
        }
        expect(sim.state.player.destroyed, `${difficulty} bearing ${v} after ${(t / 60).toFixed(0)} s`).toBe(false);
      }
    }
  }, 60_000);

  it('a T2 fighter that closes in kills it', () => {
    for (const difficulty of ['mild', 'hardcore'] as const) {
      for (const v of [0, 3, 5]) {
        const { sim } = gunnerDuel(fighter(2), difficulty, v);
        const start = hullHp(sim.state.player.grid, new Map()).max;
        let t = 0;
        for (; t < 60 * 60; t++) {
          const g = theGunner(sim);
          const p = sim.state.player;
          if (!g || p.destroyed || p.props.weapons.length === 0) break;
          p.fuel = p.props.fuelCapacity;
          const w = p.props.weapons[0]!;
          const aim = leadPoint(p.body.pos, p.body.vel, g.body.pos, g.body.vel, w.projectileSpeed);
          const d = length(sub(g.body.pos, p.body.pos));
          sim.step({ ...IDLE_COMMAND, flight: steerTo(p.body, aim, d > 22 ? 1 : 0), aim, fire: d < w.range * 0.95 });
        }
        expect(theGunner(sim), `${difficulty} bearing ${v}`).toBeUndefined();
        expect(sim.state.player.destroyed).toBe(false);
        expect(1 - hullHp(sim.state.player.grid, sim.state.player.hp).current / start).toBeLessThan(0.5);
      }
    }
  }, 60_000);

  it('aims by the difficulty: Calm misses far more than Hardcore at the standoff', () => {
    const accuracy = (difficulty: DeathPenalty) => {
      const { sim, gunner } = gunnerDuel(armedStarter(), difficulty, 0);
      gunner.body = { ...gunner.body, pos: add(sim.state.player.body.pos, { x: gunnerStandoff(gunner), y: 0 }) };
      gunner.props = { ...gunner.props, thrust: { forward: 0, backward: 0, left: 0, right: 0 } };
      let shots = 0;
      let hits = 0;
      for (let i = 0; i < 40 * 60; i++) {
        sim.state.player.hp = new Map();
        sim.state.player.shield = 0;
        theGunner(sim);
        for (const ev of sim.step(IDLE_COMMAND)) {
          if (ev.type === 'shotFired' && ev.owner === GUNNER_ID) shots++;
          if (ev.type === 'projectileHit' && ev.owner === GUNNER_ID && ev.ref === 'player') hits++;
        }
      }
      return { shots, rate: hits / Math.max(1, shots) };
    };
    const calm = accuracy('none');
    const hardcore = accuracy('hardcore');
    expect(calm.shots).toBeGreaterThan(30);
    expect(hardcore.rate).toBeGreaterThan(0.6);
    expect(calm.rate).toBeLessThan(hardcore.rate - 0.25);
  }, 60_000);

  it('no unfair kiting: a starter flying straight at it closes in from every bearing; it never outruns the chase', () => {
    for (let v = 0; v < 8; v++) {
      const { sim } = gunnerDuel(armedStarter(), 'mild', v);
      let closed: number | null = null;
      let fastest = 0;
      for (let t = 0; t < 30 * 60 && closed === null; t++) {
        const g = theGunner(sim)!;
        const p = sim.state.player;
        p.hp = new Map();
        p.fuel = p.props.fuelCapacity;
        if (length(sub(g.body.pos, p.body.pos)) < gunnerStandoff(g) * GUNNER.evadeShare) closed = t / 60;
        if (g.ai.mode !== 'evade') fastest = Math.max(fastest, length(g.body.vel));
        sim.step({ ...IDLE_COMMAND, flight: steerTo(p.body, g.body.pos, 1) });
      }
      expect(closed, `bearing ${v}`).not.toBeNull();
      expect(fastest).toBeLessThan(GUNNER.cruiseSpeed + 2);
    }
  }, 60_000);

  it('pays for its standoff in fuel by the player’s rule and goes home on low tanks', () => {
    const { sim, gunner } = gunnerDuel(armedStarter(), 'mild', 1);
    const fuel = gunner.fuel;
    for (let t = 0; t < 20 * 60; t++) {
      sim.state.player.hp = new Map();
      theGunner(sim);
      sim.step(IDLE_COMMAND);
    }
    expect(gunner.ai.mode).toBe('attack');
    expect(gunner.fuel).toBeLessThan(fuel);
    gunner.fuel = gunner.props.fuelCapacity * LOW_FUEL * 0.5;
    sim.step(IDLE_COMMAND);
    expect(gunner.ai.mode).toBe('retreat');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// M4c: the large reactor blast (plan, T9)

/**
 * The armed starter with a T1 large reactor (2) in place of the reactor, gyro and port cargo – right
 * beside the cockpit (its blast reaches the cockpit, a cannon, the shield, the tank, the radar…).
 *
 *   y= 2      S  R  N
 *   y= 1   F  L  L  T  B
 *   y= 0   G  L  L  C  M
 *   y=-1      F  K  D  B
 *   y=-2      A  R  N
 *       x=-2 -1  0  1  2
 */
const reactorStarter = () =>
  createGrid([
    ['cockpit', 1, 0], ['largeReactor', -1, 0], ['gyro', -2, 0], ['miningLaser', 2, 0, 0], ['cargo', 0, -1],
    ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -2, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
    ['engine', 0, -2, 1], ['engine', 0, 2, 3], ['cannon', 1, 2, 0], ['cannon', 1, -2, 0], ['shield', -1, 2], ['armor', -1, -2],
  ]);

/**
 * One Jackal 70 u away on bearing `variant` of 8; the player holds fire and either keeps its nose on the
 * Jackal or holds its heading (the Jackal then reaches the reactor from behind). Seconds survived (capped
 * at `limit`) and the blasts seen.
 */
function reactorDuel(deathPenalty: DeathPenalty, variant: number, opts: { steer: boolean; reactorHp?: number; limit?: number }): { seconds: number; blasts: number } {
  const sim = new Simulation({ seed: 9100 + variant, startDocked: false, generator: emptySpace, settings: { deathPenalty }, grid: reactorStarter() });
  const a = (variant / 8) * Math.PI * 2;
  const pos = add(sim.state.player.body.pos, rotate({ x: 70, y: 0 }, a));
  const id = `pr:duel:${variant}`;
  sim.state.combat.enemies = [createEnemy({ id, kind: 'jackal', tier: 1, pos, angle: a + Math.PI, home: pos, orbit: variant % 2 === 0 ? 1 : -1 })];
  if (opts.reactorHp !== undefined) sim.state.player.hp.set(2, opts.reactorHp);
  const limit = (opts.limit ?? 40) * 60;
  let blasts = 0;
  let t = 0;
  for (; t < limit; t++) {
    sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => e.id === id);
    const e = sim.state.combat.enemies[0];
    const p = sim.state.player;
    if (!e || p.destroyed) break;
    p.fuel = p.props.fuelCapacity;
    const cmd = opts.steer ? { ...IDLE_COMMAND, flight: steerTo(p.body, e.body.pos, 0) } : IDLE_COMMAND;
    for (const ev of sim.step(cmd)) if (ev.type === 'partBlast' && ev.ref === 'player') blasts++;
  }
  return { seconds: sim.state.player.destroyed ? t / 60 : limit / 60, blasts };
}

describe('large reactor fairness (M4c §2.4)', () => {
  it('the reactor starter is a valid ship with the reactor 8-adjacent to the cockpit', () => {
    const grid = reactorStarter();
    expect(validateGrid(grid)).toEqual([]);
    expect(blastNeighbours(grid, grid.parts.find((p) => p.id === 2)!)).toContain(1);
  });

  it('a starter-class ship with a large reactor beside the cockpit lasts 40+ s against one Jackal (Calm, Standard)', () => {
    for (const difficulty of ['none', 'mild'] as const) {
      for (let v = 0; v < 8; v++) {
        const r = reactorDuel(difficulty, v, { steer: true });
        expect(r.seconds, `${difficulty} bearing ${v}`).toBeGreaterThanOrEqual(40);
      }
    }
  }, 120_000);

  it('a risk, not a death sentence: with the reactor nearly gone and exposed it blows, and the ship still lasts 40+ s', () => {
    let blasts = 0;
    for (const difficulty of ['none', 'mild'] as const) {
      for (let v = 0; v < 8; v++) {
        const r = reactorDuel(difficulty, v, { steer: false, reactorHp: 20, limit: 60 });
        blasts += r.blasts;
        expect(r.seconds, `${difficulty} bearing ${v}`).toBeGreaterThanOrEqual(40);
      }
    }
    expect(blasts).toBeGreaterThan(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// M4d: the Guild Watch nearby (plan T4)

/**
 * A point on a Guild Lane in a Guarded depth-2 sector, clear of stations, where a scheduled Watch ship
 * (a lane patrol) is within 250 u at the state's tick – or, while the schedule has none there, the first
 * such lane point (the comparison is then trivially equal).
 */
function besideLanePatrol(sim: Simulation): { x: number; y: number } {
  const { state } = sim;
  let fallback: { x: number; y: number } | null = null;
  for (const lane of sectorLanes(state.seed)) {
    for (let k = 1; k < lane.points.length; k++) {
      const a = lane.points[k - 1]!;
      const b = lane.points[k]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 100));
      for (let i = 0; i < n; i++) {
        const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
        if (sectorInfoAt(state.seed, p.x, p.y).depth !== 2 || securityHere(state, p) !== 'guarded') continue;
        if (state.world.stationCirclesNear(p, 400).length > 0) continue;
        fallback ??= p;
        if (scheduledWatchNear(state, p, 250).length > 0) return p;
      }
    }
  }
  if (!fallback) throw new Error('no Guarded depth-2 lane point');
  return fallback;
}

/**
 * The armed starter (holding fire, nose on the nearest pirate) against a Hammer + Jackal T1 120 u away on
 * bearing `variant` of 8, beside a lane patrol. Seconds survived (capped at `limit`).
 */
function watchDuel(variant: number, withWatch: boolean, limit = 90): number {
  guild.off = !withWatch;
  try {
    const sim = new Simulation({ seed: 77, startDocked: false, generator: emptySpace, settings: { deathPenalty: 'mild' }, grid: armedStarter() });
    sim.state.tick = 1;
    const at = besideLanePatrol(sim);
    const p = sim.state.player;
    p.body = { ...p.body, pos: at, vel: { x: 0, y: 0 } };
    p.prevBody = p.body;
    const a = (variant / 8) * Math.PI * 2;
    const ids = [`pr:watchDuel:${variant}:h`, `pr:watchDuel:${variant}:j`];
    sim.state.combat.enemies = (['hammer', 'jackal'] as const).map((kind, i) => {
      const pos = add(at, rotate({ x: 120 + i * 15, y: i * 12 }, a));
      return createEnemy({ id: ids[i]!, kind, tier: 1, pos, angle: a + Math.PI, home: pos, orbit: variant % 2 === 0 ? 1 : -1 });
    });
    let t = 0;
    for (; t < limit * 60; t++) {
      sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => ids.includes(e.id));
      if (sim.state.combat.enemies.length === 0 || p.destroyed) break;
      p.fuel = p.props.fuelCapacity;
      const near = sim.state.combat.enemies.reduce((m, e) => (length(sub(e.body.pos, p.body.pos)) < length(sub(m.body.pos, p.body.pos)) ? e : m));
      sim.step({ ...IDLE_COMMAND, flight: steerTo(p.body, near.body.pos, 0) });
    }
    return p.destroyed ? t / 60 : limit;
  } finally {
    guild.off = true;
  }
}

describe('Guild Watch fairness (M4d T4)', () => {
  it('the starter beside a lane patrol in a Guarded depth-2 sector survives a Hammer + Jackal at least as long as without the Watch', () => {
    let alone = 0;
    let watched = 0;
    for (let v = 0; v < 8; v++) {
      alone += watchDuel(v, false);
      watched += watchDuel(v, true);
    }
    expect(watched).toBeGreaterThanOrEqual(alone);
  }, 180_000);
});
