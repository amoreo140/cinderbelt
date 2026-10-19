// Combat balance harness: a scripted pilot (perfect lead aim, keeps ~22 u from the target) fights a
// Jackal or a Hammer, and a T2 fighter takes a Rust fortress (generators from behind, the two front
// turrets, then the core). The quick check always runs; the full table (every difficulty, eight
// approaches per fight) only with BALANCE_REPORT=1:
//   BALANCE_REPORT=1 npx vitest run src/sim/combat/balance.test.ts
import { describe, expect, it } from 'vitest';
import { FORTRESS } from '../../data/pirates';
import type { Tier } from '../../data/parts';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { teleport } from '../discovery/testing';
import { clamp } from '../math/angle';
import type { Body } from '../physics/body';
import type { FlightInput } from '../ship/control';
import { add, length, rotate, scale, sub, type Vec2 } from '../math/vec2';
import { fortressStatus } from '../pirates/fortress';
import type { FortressState } from '../pirates/state';
import { FORTRESS_LAYOUT, fortressSites, fortressToWorld, type FortressSite } from '../pirates/sites';
import { DEATH_PENALTIES, type DeathPenalty } from '../settings';
import { createGrid } from '../ship/grid';
import { hullHp } from '../ship/hp';
import type { ShipGrid } from '../ship/types';
import { Simulation, type SimEvent } from '../Simulation';
import { blockedExhausts } from '../ship/exhaust';
import { filledFull, halapartnaE2 } from '../ship/specShips.testing';
import { createCaptainEnemy } from '../captains/captains';
import { steerTo } from './ai';
import { createEnemy } from './enemies';
import type { Enemy, EnemyKind } from './types';
import { leadPoint } from './weapons';

const TICKS = 60;
/** The full report runs only on request (the tsconfig has no Node types, hence the cast). */
const REPORT = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BALANCE_REPORT;

/**
 * The reference fighter of the fortress tests (two forward cannons, shield, armour in front) with its
 * side engines turned outwards – in the tests they blow into the reactor (a covered nozzle).
 */
const fighter = (tier: Tier): ShipGrid =>
  createGrid([
    ['cockpit', 0, 0, 0, tier],
    ['gyro', 0, 2, 0, tier],
    ['cannon', 1, 1, 0, tier],
    ['cannon', 1, -1, 0, tier],
    ['armor', 1, 0, 0, tier],
    ['reactor', -1, 0, 0, tier],
    ['shield', 0, 1, 0, tier],
    ['cargo', 0, -1, 0, tier],
    ['engine', -2, 0, 0, tier],
    ['engine', 2, 0, 2, tier],
    ['engine', -1, 1, 3, tier],
    ['engine', -1, -1, 1, tier],
  ]);

export interface FightResult {
  outcome: 'kill' | 'fled' | 'died' | 'crippled' | 'timeout';
  seconds: number;
  /** Share of the player's hull HP lost (0..1). */
  hullLost: number;
  /** Pirate (or turret) shots fired and the ones that hit the player (shield or hull). */
  shots: number;
  hits: number;
  /** Fortress only: share of the plan's HP (generators, front turrets, core) destroyed. */
  progress?: number;
  /** Seconds from the player's first shot to the end (the time to kill under fire). */
  underFire?: number;
}

/** The first spot near `from` with no rock within `clear` (spiral search). */
function clearSpot(sim: Simulation, from: Vec2, clear: number): Vec2 {
  for (let r = 0; r < 4000; r += 40) {
    for (let a = 0; a < 16; a++) {
      const p = add(from, { x: Math.cos((a / 16) * Math.PI * 2) * r, y: Math.sin((a / 16) * Math.PI * 2) * r });
      sim.state.world.update(p);
      if (sim.state.world.circlesNear(p, clear).length === 0 && sim.state.world.stationCirclesNear(p, clear + 200).length === 0) return p;
    }
  }
  throw new Error('no clear spot');
}

/** Keeps only the fight's own pirates (the world's groups, raids and scavengers stay away). */
function clearAmbient(sim: Simulation, keep: (e: Enemy) => boolean): void {
  const { combat, tick } = sim.state;
  for (const e of combat.enemies) if (!keep(e)) combat.defeated.set(e.id, tick);
  combat.enemies = combat.enemies.filter(keep);
}

function pilot(sim: Simulation, aimAt: Vec2, targetVel: Vec2, standoff: number, fire: boolean): PlayerCommand {
  const p = sim.state.player;
  const w = p.props.weapons[0]!;
  const aim = leadPoint(p.body.pos, p.body.vel, aimAt, targetVel, w.projectileSpeed);
  const d = length(sub(aimAt, p.body.pos));
  const flight = steerTo(p.body, aim, d > standoff ? 1 : 0);
  return { ...IDLE_COMMAND, flight, aim, fire: fire && d < w.range * 0.95 };
}

/** Station keeping: fly to `spot` (at most 12 u/s, slowing down near it) while turning to `face`. */
function hover(body: Body, spot: Vec2, face: Vec2): FlightInput {
  const to = sub(spot, body.pos);
  const dist = length(to);
  const desired = dist > 1e-6 ? scale(to, Math.min(12, dist * 0.5) / dist) : { x: 0, y: 0 };
  const err = rotate(sub(desired, body.vel), -body.angle);
  return { forward: clamp(err.x * 0.5, -1, 1), strafe: clamp(err.y * 0.5, -1, 1), turn: steerTo(body, face, 0).turn };
}

const hullOf = (sim: Simulation) => hullHp(sim.state.player.grid, sim.state.player.hp).current;

function countShots(events: readonly SimEvent[], owner: (o: string) => boolean, r: { shots: number; hits: number }): void {
  for (const e of events) {
    if (e.type === 'shotFired' && owner(e.owner)) r.shots++;
    if (e.type === 'projectileHit' && owner(e.owner) && e.ref === 'player') r.hits++;
  }
}

/** One duel: the pirate starts 70 u away on approach `variant` of 8 and notices the player at once. */
export function duel(kind: EnemyKind, tier: Tier, deathPenalty: DeathPenalty, variant: number, limit = 180): FightResult {
  const id = `pr:duel:${variant}`;
  return duelWith(fighter(tier), (pos, angle) => createEnemy({ id, kind, tier, pos, angle, home: pos, orbit: variant % 2 === 0 ? 1 : -1 }), deathPenalty, variant, limit);
}

/** A duel of the player's ship `grid` against the enemy `spawn` makes (at `pos`, facing `angle`). */
export function duelWith(grid: ShipGrid, spawn: (pos: Vec2, angle: number) => Enemy, deathPenalty: DeathPenalty, variant: number, limit = 180): FightResult {
  const seed = 9100 + variant;
  const sim = new Simulation({ seed, startDocked: false, grid, settings: { deathPenalty } });
  const base = clearSpot(sim, { x: 2400, y: -1300 }, 160);
  teleport(sim, base);
  const a = (variant / 8) * Math.PI * 2;
  const pos = add(base, rotate({ x: 70, y: 0 }, a));
  const enemy = spawn(pos, a + Math.PI);
  const id = enemy.id;
  sim.state.combat.enemies.push(enemy);
  const startHull = hullHp(sim.state.player.grid, new Map()).max;
  const r = { shots: 0, hits: 0 };
  let firstShot: number | null = null;
  for (let t = 0; t < limit * TICKS; t++) {
    clearAmbient(sim, (e) => e.id === id);
    const e = sim.state.combat.enemies.find((x) => x.id === id);
    const player = sim.state.player;
    const done = (outcome: FightResult['outcome']): FightResult => ({
      outcome, seconds: t / TICKS, hullLost: 1 - hullOf(sim) / startHull, ...r, ...(firstShot !== null ? { underFire: (t - firstShot) / TICKS } : {}),
    });
    if (player.destroyed) return done('died');
    if (!e) return done('kill');
    if (player.props.weapons.length === 0) return done('crippled');
    if (length(sub(e.body.pos, player.body.pos)) > 300) return done('fled');
    player.fuel = player.props.fuelCapacity;
    const events = sim.step(pilot(sim, e.body.pos, e.body.vel, 22, true));
    if (firstShot === null && events.some((x) => x.type === 'shotFired' && x.owner === 'player')) firstShot = t;
    countShots(events, (o) => o === id, r);
  }
  return { outcome: 'timeout', seconds: limit, hullLost: 1 - hullOf(sim) / startHull, ...r };
}

/** The starter ship with two cannons, a shield and armour (the combat e2e's fighter). */
const armedStarter = (): ShipGrid =>
  createGrid([
    ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
    ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
    ['engine', 0, -2, 1], ['engine', 0, 2, 3], ['cannon', 1, 2, 0], ['cannon', 1, -2, 0], ['shield', -1, 2], ['armor', -1, -2],
  ]);

/**
 * Design target (long-term design, M3 tuning): the starter ship with two cannons and a shield lasts
 * 40+ s against one Jackal. Here it does not shoot back and only keeps its nose on the Jackal.
 */
export function survival(deathPenalty: DeathPenalty, variant: number, limit = 180): FightResult {
  const seed = 9100 + variant;
  const sim = new Simulation({ seed, startDocked: false, grid: armedStarter(), settings: { deathPenalty } });
  const base = clearSpot(sim, { x: 2400, y: -1300 }, 160);
  teleport(sim, base);
  const a = (variant / 8) * Math.PI * 2;
  const pos = add(base, rotate({ x: 70, y: 0 }, a));
  const id = `pr:duel:${variant}`;
  sim.state.combat.enemies.push(createEnemy({ id, kind: 'jackal', tier: 1, pos, angle: a + Math.PI, home: pos, orbit: variant % 2 === 0 ? 1 : -1 }));
  const startHull = hullHp(sim.state.player.grid, new Map()).max;
  const r = { shots: 0, hits: 0 };
  for (let t = 0; t < limit * TICKS; t++) {
    clearAmbient(sim, (e) => e.id === id);
    const e = sim.state.combat.enemies.find((x) => x.id === id);
    const player = sim.state.player;
    if (player.destroyed) return { outcome: 'died', seconds: t / TICKS, hullLost: 1, ...r };
    if (!e || length(sub(e.body.pos, player.body.pos)) > 300) return { outcome: 'fled', seconds: t / TICKS, hullLost: 1 - hullOf(sim) / startHull, ...r };
    player.fuel = player.props.fuelCapacity;
    countShots(sim.step({ ...IDLE_COMMAND, flight: hover(player.body, base, e.body.pos) }), (o) => o === id, r);
  }
  return { outcome: 'timeout', seconds: limit, hullLost: 1 - hullOf(sim) / startHull, ...r };
}

const PLAN_HP = 2 * FORTRESS.generatorHp + 2 * FORTRESS.turretHp + FORTRESS.coreHp;
const progress = (f: FortressState): number =>
  f.destroyed !== null ? 1 : 1 - (f.gens[0]! + f.gens[1]! + f.turrets[0]! + f.turrets[1]! + f.core) / PLAN_HP;

/** The fortress: generators from behind, then the two front turrets, then the core; reinforcements first. */
export function fortressAssault(deathPenalty: DeathPenalty, variant: number, limit = 300): FightResult & { jackals: number } {
  const seed = 4242 + variant;
  const sim = new Simulation({ seed, startDocked: false, grid: fighter(2), settings: { deathPenalty } });
  const site: FortressSite = fortressSites(seed)[0]!;
  const start = fortressToWorld(site, { x: -110, y: (variant - 1.5) * 12 });
  teleport(sim, start, site.angle);
  const startHull = hullHp(sim.state.player.grid, new Map()).max;
  const r = { shots: 0, hits: 0 };
  let jackals = 0;
  const ours = (e: Enemy) => e.id.startsWith(`fr:${site.index}:`);
  const order: { kind: 'gen' | 'turret' | 'core'; index: number }[] = [
    { kind: 'gen', index: 0 },
    { kind: 'gen', index: 1 },
    { kind: 'turret', index: 0 },
    { kind: 'turret', index: 1 },
    { kind: 'core', index: 0 },
  ];
  for (let t = 0; t < limit * TICKS; t++) {
    clearAmbient(sim, ours);
    const player = sim.state.player;
    const f = fortressStatus(sim.state, site.id);
    const done = (outcome: FightResult['outcome']) => ({ outcome, seconds: t / TICKS, hullLost: 1 - hullOf(sim) / startHull, ...r, jackals, progress: progress(f) });
    if (player.destroyed) return done('died');
    if (f.destroyed !== null) return done('kill');
    if (player.props.weapons.length === 0) return done('crippled');
    player.fuel = player.props.fuelCapacity;
    const near = sim.state.combat.enemies
      .filter(ours)
      .map((e) => ({ e, d: length(sub(e.body.pos, player.body.pos)) }))
      .filter((x) => x.d < 70 && length(sub(x.e.body.pos, site.pos)) < 110)
      .sort((x, y) => x.d - y.d)[0];
    let cmd: PlayerCommand;
    const ring = FORTRESS_LAYOUT.clearRadius + 18;
    if (near) {
      // reinforcements first – from a spot on the ring around the rock
      const out = sub(player.body.pos, site.pos);
      const spot = add(site.pos, scale(out, ring / Math.max(1e-6, length(out))));
      const c = pilot(sim, near.e.body.pos, near.e.body.vel, 1e9, true);
      cmd = { ...c, flight: hover(player.body, spot, c.aim) };
    } else {
      const next = order.find((o) => (o.kind === 'gen' ? f.gens[o.index]! > 0 : o.kind === 'turret' ? f.turrets[o.index]! > 0 : true))!;
      const local = next.kind === 'gen' ? FORTRESS_LAYOUT.shieldGens[next.index]! : next.kind === 'turret' ? FORTRESS_LAYOUT.turrets[next.index]! : FORTRESS_LAYOUT.core;
      const target = fortressToWorld(site, local);
      // hold 45 u out from the rock on the target's side and shoot it
      const out = next.kind === 'core' ? sub(player.body.pos, site.pos) : sub(target, site.pos);
      const spot = add(site.pos, scale(out, ring / Math.max(1e-6, length(out))));
      // hover at the spot facing the target and shoot it (also on the way, whenever it is in an arc)
      cmd = { ...pilot(sim, target, { x: 0, y: 0 }, 1e9, true), flight: hover(player.body, spot, target) };
    }
    const events = sim.step(cmd);
    for (const e of events) if (e.type === 'shipDestroyed' && e.ref.startsWith(`fr:${site.index}:`)) jackals++;
    countShots(events, (o) => o === `fort:${site.index}` || o.startsWith(`fr:${site.index}:`), r);
  }
  return { outcome: 'timeout', seconds: limit, hullLost: 1 - hullOf(sim) / startHull, ...r, jackals, progress: progress(fortressStatus(sim.state, site.id)) };
}

interface Summary {
  fight: string;
  difficulty: DeathPenalty;
  outcomes: string;
  ttk: string;
  hullLost: string;
  accuracy: string;
  progress: string;
  underFire: string;
}

function summarize(fight: string, difficulty: DeathPenalty, results: readonly FightResult[]): Summary {
  const kills = results.filter((x) => x.outcome === 'kill');
  const avg = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
  const count = (o: FightResult['outcome']) => results.filter((x) => x.outcome === o).length;
  const shots = results.reduce((s, x) => s + x.shots, 0);
  const hits = results.reduce((s, x) => s + x.hits, 0);
  return {
    fight,
    difficulty,
    outcomes: (['kill', 'fled', 'died', 'crippled', 'timeout'] as const).filter((o) => count(o) > 0).map((o) => `${o} ${count(o)}`).join(', '),
    ttk: kills.length ? `${avg(kills.map((x) => x.seconds)).toFixed(1)} s (${Math.min(...kills.map((x) => x.seconds)).toFixed(1)}–${Math.max(...kills.map((x) => x.seconds)).toFixed(1)})` : '–',
    hullLost: `${(avg(results.map((x) => x.hullLost)) * 100).toFixed(0)} %`,
    accuracy: shots ? `${((hits / shots) * 100).toFixed(0)} % of ${shots}` : '–',
    progress: results[0]?.progress !== undefined ? `${(avg(results.map((x) => x.progress!)) * 100).toFixed(0)} %` : '',
    underFire: kills.some((x) => x.underFire !== undefined) ? `${avg(kills.map((x) => x.underFire ?? 0)).toFixed(1)} s` : '',
  };
}

describe('combat balance', () => {
  it('the reference fighter covers no nozzle', () => {
    expect(blockedExhausts(fighter(1))).toEqual([]);
  });

  it('a T1 fighter beats a T1 Jackal head-on', () => {
    const r = duel('jackal', 1, 'mild', 0, 120);
    expect(['kill', 'fled']).toContain(r.outcome);
    expect(r.hullLost).toBeLessThan(0.6);
  });

  // SL2 E2 (plan B1): shaped armour buys arcs (a wedge beside a cannon) and a lighter, faster
  // turning bow, and pays with HP. Example C after E2 vs the same cells laid full, against a T2 Hammer and a
  // level-3 captain (T2), eight approaches each: it may win a little faster, never clearly more – at most
  // one more win, pooled time to kill ≥ 80 % of the full-cell ship's, hull lost ≥ the full-cell ship's − 5 %.
  it('example C with shaped armour is not clearly stronger than the same cells laid full', () => {
    const foes = {
      hammer: (v: number) => (pos: Vec2, angle: number) => createEnemy({ id: `pr:duel:${v}`, kind: 'hammer', tier: 2, pos, angle, home: pos, orbit: v % 2 === 0 ? 1 : -1 }),
      captain3: () => (pos: Vec2, angle: number) => createCaptainEnemy(0, 3, pos, angle),
    };
    const ships = { shaped: halapartnaE2(), full: filledFull(halapartnaE2()) };
    const sum = (rs: readonly FightResult[]) => {
      const kills = rs.filter((r) => r.outcome === 'kill');
      return {
        wins: rs.filter((r) => r.outcome === 'kill' || r.outcome === 'fled').length,
        ttk: kills.reduce((s, r) => s + r.seconds, 0) / Math.max(1, kills.length),
        hullLost: rs.reduce((s, r) => s + r.hullLost, 0) / rs.length,
      };
    };
    const table: Record<string, ReturnType<typeof sum>> = {};
    const stats = Object.fromEntries(
      Object.entries(ships).map(([name, grid]) => {
        const byFoe = Object.entries(foes).map(([foe, make]) => {
          const rs = [0, 1, 2, 3, 4, 5, 6, 7].map((v) => duelWith(grid, make(v), 'mild', v, 120));
          table[`${name} vs ${foe}`] = sum(rs);
          return rs;
        });
        return [name, sum(byFoe.flat())];
      }),
    );
    const { shaped, full } = stats as Record<'shaped' | 'full', ReturnType<typeof sum>>;
    if (REPORT) console.table({ ...table, ...stats });
    expect(shaped.wins).toBeLessThanOrEqual(full.wins + 1);
    expect(shaped.ttk).toBeGreaterThanOrEqual(full.ttk * 0.8);
    expect(shaped.hullLost).toBeGreaterThanOrEqual(full.hullLost - 0.05);
  }, 600_000);

  it.runIf(REPORT)('report: time to kill and damage taken by difficulty', () => {
    const rows: Summary[] = [];
    for (const d of DEATH_PENALTIES) {
      const v = [0, 1, 2, 3, 4, 5, 6, 7];
      rows.push(summarize('T1 fighter vs T1 Jackal', d, v.map((i) => duel('jackal', 1, d, i))));
      const lasted = v.map((i) => survival(d, i));
      rows.push({
        ...summarize('armed starter holds fire vs Jackal', d, lasted),
        ttk: `lasts ${(lasted.reduce((s, x) => s + x.seconds, 0) / lasted.length).toFixed(0)} s (min ${Math.min(...lasted.map((x) => x.seconds)).toFixed(0)})`,
      });
      rows.push(summarize('T1 fighter vs T1 Hammer', d, v.map((i) => duel('hammer', 1, d, i))));
      rows.push(summarize('T2 fighter vs fortress', d, [0, 1, 2, 3].map((i) => fortressAssault(d, i))));
    }
    console.table(rows);
  }, 1_200_000);
});
