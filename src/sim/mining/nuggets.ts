// Rich nuggets (Mining 2.0, plan): while a laser mines, a chunk of rich ore
// sometimes breaks off the rock and drifts away with a spin. Flying through it (a small magnet at
// the hull) or pulling it with the tractor beam puts its ore into the hold; after a while it is gone.
//
// Deterministic: a roll every NUGGET.stepUnits rock units mined from an asteroid, seeded by the world
// seed, the asteroid id and the roll index (the mined amount is saved anyway). The chance is per
// second of the laser's mining – higher on the active vein segment and scaled by the ore grade – and
// the nugget's ore (a few seconds of that laser's mining) is taken out of the rock. Live nuggets are
// saved (save V12, MiningState) – a reload continues exactly.
import { NUGGET } from '../../data/ore';
import { cargoUsed, type ResourceId } from '../../data/resources';
import { VEIN_ANALYZER } from '../../data/sites';
import { hasFeature } from '../discovery/archive';
import { radarRangeOf } from '../discovery/scanner';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { createRng } from '../math/rng';
import { add, length, rotate, scale, sub, type Vec2 } from '../math/vec2';
import type { Body } from '../physics/body';
import { resolveCollisions } from '../physics/collide';
import type { SimEvent, SimState } from '../Simulation';
import { canCrack, ICE_CRACK_AT } from '../world/fragments';
import { hash3 } from '../world/hash';
import { assayChunksAround, chunkOfAsteroid, isRich, oreGrade } from './grade';
import type { Extraction } from './mining';

const NUGGET_SALT = 0x4e75_6767;
const ONE_CELL: readonly Vec2[] = [{ x: 0, y: 0 }];
const TICKS = 60;
/** Half the diagonal of a hull cell – the magnet measures from the cell, not from the bounding circle. */
const CELL_REACH = Math.SQRT1_2;

export interface Nugget {
  id: number;
  resource: ResourceId;
  /** Ore in it (cargo units, grade included). */
  amount: number;
  grade: number;
  /** The rock it broke off. */
  source: string;
  body: Body;
  /** Pose before the last step (render interpolation, not saved). */
  prevBody: Body;
  /** Steps until it is gone. */
  ttl: number;
}

/** Mining state that is not in the world delta: live nuggets and the chunks the scanner assayed. */
export interface MiningState {
  nextId: number;
  nuggets: Nugget[];
  /** Chunk keys whose rocks' grades the scanner revealed (pulse or rock analysis). */
  assayed: Set<string>;
}

export const createMiningState = (): MiningState => ({ nextId: 1, nuggets: [], assayed: new Set() });

export type MiningEvent =
  | { type: 'nuggetSpawned'; id: number; pos: Vec2; vel: Vec2; resource: ResourceId; amount: number; grade: number }
  | { type: 'nuggetCollected'; id: number; pos: Vec2; resource: ResourceId; amount: number; cargoFull: boolean }
  | { type: 'nuggetLost'; id: number; pos: Vec2; reason: 'expired' | 'cap' }
  /** The scanner revealed ore grades around the ship: rocks in reach, rich ones and the best grade. */
  | { type: 'oreAssayed'; rocks: number; rich: number; best: number };

/** Is the rock's grade known to the player (its chunk was assayed)? */
export const gradeKnown = (state: SimState, a: { id: string; pos: Vec2 }): boolean => state.mining.assayed.has(chunkOfAsteroid(a));

/** Chance of a nugget per roll for this extraction (one roll per NUGGET.stepUnits rock units). */
export function nuggetChance(x: Pick<Extraction, 'onVein' | 'grade' | 'laserRate' | 'bonus'>): number {
  const rockRate = x.laserRate * x.bonus;
  if (rockRate <= 0) return 0;
  const perSecond = (x.onVein ? NUGGET.perSecond.vein : NUGGET.perSecond.rock) * x.grade;
  return Math.min(0.9, (perSecond * NUGGET.stepUnits) / rockRate);
}

/** Rolls for nuggets after a mining step (Simulation calls it right after runMining). */
export function spawnNuggets(state: SimState, extractions: readonly Extraction[], events: SimEvent[]): void {
  for (const x of extractions) {
    const a = x.asteroid;
    const mined = (left: number) => Math.floor((a.initialAmount - left) / NUGGET.stepUnits + 1e-9);
    const k0 = mined(x.before);
    const k1 = mined(x.before - x.taken);
    if (k1 <= k0) continue;
    const chance = nuggetChance(x);
    for (let k = k0 + 1; k <= k1; k++) {
      const h = nuggetRoll(state.seed, a.id, k);
      if (h / 4294967296 < chance) breakOff(state, x, h, events);
    }
  }
}

function breakOff(state: SimState, x: Extraction, seed: number, events: SimEvent[]): void {
  const { world } = state;
  const a = x.asteroid;
  if (world.radiusOf(a) <= 0) return;
  // the nugget never depletes the rock nor cracks the ice (both are mining's business)
  const floor = (canCrack(a) ? ICE_CRACK_AT * a.initialAmount : 0) + NUGGET.keepRock;
  const rock = Math.min(NUGGET.seconds * x.laserRate, world.remaining(a) - floor);
  if (rock < NUGGET.minRock) return;
  world.extract(a, rock);
  const rng = createRng(seed);
  const out = sub(x.to, a.pos);
  const len = length(out);
  const toShip = sub(state.player.body.pos, a.pos);
  const normal = len > 1e-6 ? scale(out, 1 / len) : scale(toShip, 1 / Math.max(1e-6, length(toShip)));
  const pos = add(a.pos, scale(normal, world.radiusOf(a) + NUGGET.radius + 0.15));
  releaseNugget(state, rng, { resource: a.resource, amount: rock * x.grade, grade: x.grade, source: a.id, pos, normal, baseVel: null }, events);
}

/** A nugget about to break off: where, which way (unit normal), what and from what. */
interface NuggetSpec {
  resource: ResourceId;
  /** Ore in it (cargo units, grade included). */
  amount: number;
  grade: number;
  source: string;
  pos: Vec2;
  normal: Vec2;
  /** Velocity of a moving source (a comet nucleus) the drift adds to; null = a still rock. */
  baseVel: Vec2 | null;
}

/** Spins a nugget off along the normal (rng: spread, speed, angle, spin – in this order) and keeps the cap. */
function releaseNugget(state: SimState, rng: () => number, spec: NuggetSpec, events: SimEvent[]): void {
  const dir = rotate(spec.normal, (rng() * 2 - 1) * NUGGET.spread);
  const speed = NUGGET.speed[0] + (NUGGET.speed[1] - NUGGET.speed[0]) * rng();
  const drift = scale(dir, speed);
  const vel = spec.baseVel ? add(spec.baseVel, drift) : drift;
  const pos = spec.pos;
  const body: Body = { pos, vel, angle: rng() * TAU, angVel: (rng() * 2 - 1) * NUGGET.spin };
  const m = state.mining;
  while (m.nuggets.length >= NUGGET.cap) {
    const old = m.nuggets.shift()!;
    lose(state, old, 'cap', events);
  }
  const nugget: Nugget = {
    id: m.nextId++,
    resource: spec.resource,
    amount: spec.amount,
    grade: spec.grade,
    source: spec.source,
    body,
    prevBody: body,
    ttl: Math.round(NUGGET.ttlSeconds * TICKS),
  };
  m.nuggets.push(nugget);
  events.push({ type: 'nuggetSpawned', id: nugget.id, pos: { ...pos }, vel: { ...body.vel }, resource: nugget.resource, amount: nugget.amount, grade: spec.grade });
}

/** The roll hash of nugget roll `k` of a source key (a rock id, or a comet's `cm:<n>@<pass>`). */
export const nuggetRoll = (seed: number, key: string, k: number): number => hash3(seed ^ NUGGET_SALT, fnv1a32(key), k);

/**
 * A nugget breaking off a moving target (M4b comet nucleus, sim/sites/cometMining.ts): the caller has
 * taken `rock` units out of the target already. It leaves the surface at the beam's hit point with the
 * target's velocity plus the usual drift.
 */
export function spawnMoverNugget(
  state: SimState,
  roll: number,
  src: { source: string; resource: ResourceId; rock: number; grade: number; center: Vec2; radius: number; vel: Vec2; to: Vec2 },
  events: SimEvent[],
): void {
  const rng = createRng(roll);
  const out = sub(src.to, src.center);
  const len = length(out);
  const toShip = sub(state.player.body.pos, src.center);
  const normal = len > 1e-6 ? scale(out, 1 / len) : scale(toShip, 1 / Math.max(1e-6, length(toShip)));
  const pos = add(src.center, scale(normal, src.radius + NUGGET.radius + 0.15));
  releaseNugget(state, rng, { resource: src.resource, amount: src.rock * src.grade, grade: src.grade, source: src.source, pos, normal, baseVel: src.vel }, events);
}

/** The tractor lets go of a nugget that is gone. */
function dropTow(state: SimState, id: number, reason: 'loaded' | 'lost', events: SimEvent[]): void {
  const t = state.player.tractor;
  if (t && t.target.kind === 'nugget' && t.target.id === id) {
    state.player.tractor = null;
    events.push({ type: 'tractorReleased', reason });
  }
}

function lose(state: SimState, n: Nugget, reason: 'expired' | 'cap', events: SimEvent[]): void {
  dropTow(state, n.id, 'lost', events);
  events.push({ type: 'nuggetLost', id: n.id, pos: { ...n.body.pos }, reason });
}

/** Distance from the nugget to the nearest hull cell (minus the cell) and the direction to it. */
function hullGap(state: SimState, p: Vec2): { gap: number; dir: Vec2 } {
  const { body, props } = state.player;
  let best = Infinity;
  let dir: Vec2 = { x: 0, y: 0 };
  for (const c of props.cellOffsets) {
    const w = add(body.pos, rotate(c, body.angle));
    const d = sub(w, p);
    const l = length(d);
    if (l < best) {
      best = l;
      dir = l > 1e-9 ? scale(d, 1 / l) : { x: 0, y: 0 };
    }
  }
  return { gap: best - CELL_REACH, dir };
}

/** Drift, magnet, pickup and despawn of the nuggets – every step, after the tractor beam. */
export function stepNuggets(state: SimState, dt: number, events: SimEvent[]): void {
  const m = state.mining;
  if (m.nuggets.length === 0) return;
  const player = state.player;
  const canCollect = player.dock.mode === 'flying' && !player.destroyed;
  const keep: Nugget[] = [];
  for (const n of m.nuggets) {
    n.prevBody = n.body;
    let vel = n.body.vel;
    if (canCollect) {
      const free = player.props.cargoCapacity - cargoUsed(player.cargo);
      const { gap, dir } = hullGap(state, n.body.pos);
      if (free > 1e-6 && gap <= NUGGET.collectRange) {
        const take = Math.min(n.amount, free);
        player.cargo[n.resource] += take;
        state.stats.mined[n.resource] += take;
        n.amount -= take;
        const full = free - take <= 1e-9;
        events.push({ type: 'nuggetCollected', id: n.id, pos: { ...n.body.pos }, resource: n.resource, amount: take, cargoFull: full });
        if (full) events.push({ type: 'cargoFull' });
        if (n.amount <= 1e-9) {
          dropTow(state, n.id, 'loaded', events);
          continue;
        }
      } else if (free > 1e-6 && gap < NUGGET.magnetRange) {
        const pull = NUGGET.magnetAccel * (1 - gap / NUGGET.magnetRange) + 1;
        const match = Math.min(1, NUGGET.magnetMatch * dt);
        vel = add(add(vel, scale(dir, pull * dt)), scale(sub(player.body.vel, vel), match));
      }
    }
    const k = Math.max(0, 1 - NUGGET.damping * dt);
    vel = scale(vel, k);
    const moved: Body = {
      pos: add(n.body.pos, scale(vel, dt)),
      vel,
      angle: n.body.angle + n.body.angVel * dt,
      angVel: n.body.angVel,
    };
    const reach = NUGGET.radius + 4;
    const obstacles = state.world.circlesNear(moved.pos, reach).map((c) => c.circle);
    n.body = obstacles.length > 0 ? resolveCollisions(moved, ONE_CELL, NUGGET.radius, obstacles).body : moved;
    n.ttl--;
    if (n.ttl <= 0) {
      lose(state, n, 'expired', events);
      continue;
    }
    keep.push(n);
  }
  m.nuggets = keep;
}

/** Reach of the ore assay: radar range, ×2 with the Archive "Vein analyser" (`veinAnalyzer`, M4b). */
export const assayRange = (state: SimState): number =>
  radarRangeOf(state) * (hasFeature(state, 'veinAnalyzer') ? VEIN_ANALYZER.assayRangeMult : 1);

/**
 * The scanner assays ore (Mining 2.0): a pulse or a finished rock analysis reveals the grades of
 * the rocks in the chunks within the assay reach (radar range, 2× with `veinAnalyzer`); the event sums
 * up the rocks it revealed.
 */
export function assayOre(state: SimState, events: SimEvent[]): void {
  if (!events.some((e) => e.type === 'scanPulse' || (e.type === 'analysisDone' && e.kind === 'asteroid'))) return;
  const pos = state.player.body.pos;
  const range = assayRange(state);
  const keys = new Set(assayChunksAround(pos, range));
  for (const key of keys) state.mining.assayed.add(key);
  // the summary covers every rock whose grade this assay revealed (the map shows the same rocks)
  let rocks = 0;
  let rich = 0;
  let best = 0;
  for (const asteroid of state.world.asteroids()) {
    if (!keys.has(chunkOfAsteroid(asteroid))) continue;
    const g = oreGrade(state.seed, asteroid);
    rocks++;
    if (isRich(g)) rich++;
    best = Math.max(best, g);
  }
  events.push({ type: 'oreAssayed', rocks, rich, best });
}

/** A nugget by id (tractor, render). */
export const nuggetById = (state: SimState, id: number): Nugget | null => state.mining.nuggets.find((n) => n.id === id) ?? null;
