import { cargoUsed, RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import { add, length, rotate, scale, sub, type Vec2 } from '../math/vec2';
import type { Body } from '../physics/body';
import type { Circle } from '../physics/collide';
import type { ShipProperties } from '../ship/properties';
import type { Asteroid } from '../world/generate';
import { shouldCrack } from '../world/fragments';
import type { AsteroidCircle, World } from '../world/World';
import { canFire, type LaserHeat } from './heat';
import type { MiningMover, MoverExtraction } from './movers';
import { aimDirection, raycastCircles } from './laser';
import { advanceVein, findVeinHit, VEIN_DRIFT_SPEED, veinBonus, veinDrifts, veinsOf, veinWorldLength } from './veins';

export interface MiningBeam {
  /** Index of the laser in ShipProperties.lasers. */
  laser: number;
  from: Vec2;
  to: Vec2;
  /** The asteroid hit, or null when firing into empty space (or at a station). */
  asteroidId: string | null;
  /** Resource of the asteroid hit (sound and effects). */
  resource: ResourceId | null;
  /** Mining multiplier (1 = off the vein; ×1.5 on the active segment of Fe/Cu, ×1.2 / ×1.8 on the deep Ti vein). */
  bonus: number;
  /** The vein hit (index and u of the point on it), or null. */
  vein: { index: number; u: number } | null;
  /** The beam stopped at a dismantlable wreck (id) – it cuts joints (M3.6). */
  wreck?: number;
  /** Ore grade of the rock hit (Mining 2.0); missing when nothing is mined. */
  grade?: number;
  /** The moving target hit (M4b: a comet nucleus or tail shard id, movers.ts). */
  mover?: string;
}

/** Ice that cracked in this step (effect and event). */
export interface CrackedAsteroid {
  id: string;
  pos: Vec2;
  /** Radius of the parent just before it cracked. */
  radius: number;
  fragments: string[];
}

export interface MiningParams {
  body: Body;
  props: ShipProperties;
  /** Changed in place (the mined ore is added). */
  cargo: Cargo;
  energy: number;
  aim: Vec2;
  /** Asteroids within laser reach (e.g. World.circlesNear); the circles change as rocks are mined. */
  candidates: readonly AsteroidCircle[];
  /** Obstacles that cannot be mined (stations) – the beam stops at them. */
  blockers?: readonly Circle[];
  /** Where the ore is taken from. */
  world: World;
  dt: number;
  yieldMultiplier: number;
  /** Multiplier of the vein bonus (sector state "Rich vein"). */
  veinMultiplier?: number;
  /** Simulation time (s) – rotation of the rocks and so the position of the veins. */
  time?: number;
  /** Laser heat by part id – a cooling laser does not fire. */
  heat?: ReadonlyMap<number, LaserHeat>;
  /** Ore grade of a rock (yield multiplier, Mining 2.0); default 1. */
  gradeOf?: (a: Asteroid) => number;
  /**
   * Moving targets within reach (M4b comets, movers.ts) – raycast like rocks (no vein bonus, heat as on
   * rock); the ore goes into the hold by the mover's `mix`. A cursor on or near a small mover locks the
   * laser onto its centre, so the beam tracks a moving shard.
   */
  movers?: readonly MiningMover[];
}

/** One laser taking rock units out of an asteroid in this step (nugget rolls, Mining 2.0). */
export interface Extraction {
  laser: number;
  asteroid: Asteroid;
  /** Rock units left before this laser took its share. */
  before: number;
  /** Rock units taken (the cargo got taken × grade). */
  taken: number;
  grade: number;
  bonus: number;
  onVein: boolean;
  /** Where the beam hit. */
  to: Vec2;
  /** The laser's rock units per second without the vein bonus (rate × difficulty yield). */
  laserRate: number;
}

export interface MiningResult {
  beams: MiningBeam[];
  energyUsed: number;
  mined: number;
  /** The hold filled up in this step. */
  cargoFilled: boolean;
  depleted: string[];
  /** Part ids of the lasers that mined on an active vein segment in this step (heat). */
  onVein: number[];
  cracked: CrackedAsteroid[];
  /** Every laser that took rock units in this step, in laser order. */
  extractions: Extraction[];
  /** Every laser that took rock units out of a mover in this step (M4b, `applyMoverExtractions`). */
  moverExtractions: MoverExtraction[];
}

/** An asteroid mined in this step: number of lasers on the active segment of each vein. */
interface Mined {
  asteroid: Asteroid;
  onSegment: number[];
}

export function runMining(params: MiningParams): MiningResult {
  const { body, props, cargo, aim, candidates, world, dt, yieldMultiplier } = params;
  const time = params.time ?? 0;
  let energy = params.energy;
  let free = props.cargoCapacity - cargoUsed(cargo);
  const hadSpace = free > 1e-9;
  const beams: MiningBeam[] = [];
  const depleted: string[] = [];
  const onVein: number[] = [];
  const cracked: CrackedAsteroid[] = [];
  const extractions: Extraction[] = [];
  const minedRocks = new Map<string, Mined>();
  let mined = 0;

  const circles = candidates.map((c) => c.circle);
  const blockers = params.blockers ?? [];
  const movers = params.movers ?? [];
  const moverCircles: Circle[] = movers.map((m) => ({ pos: m.pos, radius: m.radius }));
  /** Rock units left in each mover (lasers share it within the step). */
  const moverLeft = movers.map((m) => m.left);
  const moverExtractions: MoverExtraction[] = [];
  const lockedAim = movers.length > 0 ? moverLock(movers, aim) : null;

  for (let index = 0; index < props.lasers.length; index++) {
    const laser = props.lasers[index]!;
    if (!canFire(params.heat?.get(laser.partId))) continue;
    const cost = laser.energyPerSecond * dt;
    if (energy < cost) continue;
    const from = add(body.pos, rotate(laser.offset, body.angle));
    const dir = aimDirection(from, rotate(laser.facing, body.angle), lockedAim ?? aim);
    if (!dir) continue;
    energy -= cost;

    const hit = raycastCircles(from, dir, laser.range, circles);
    const moverHit = moverCircles.length > 0 ? raycastCircles(from, dir, hit ? hit.distance : laser.range, moverCircles) : null;
    const nearest = moverHit ? moverHit.distance : hit ? hit.distance : null;
    const block = raycastCircles(from, dir, nearest ?? laser.range, blockers);
    if (block && (nearest === null || block.distance < nearest)) {
      beams.push({ laser: index, from, to: add(from, scale(dir, block.distance)), asteroidId: null, resource: null, bonus: 1, vein: null });
      continue;
    }
    if (moverHit) {
      // a moving target (M4b comet): rock units by the laser rate, ore by its mix, no vein bonus
      const m = movers[moverHit.index]!;
      const to = add(from, scale(dir, moverHit.distance));
      const before = moverLeft[moverHit.index]!;
      const taken = Math.max(0, Math.min(laser.rate * dt * yieldMultiplier, before, Math.max(0, free) / m.grade));
      moverLeft[moverHit.index] = before - taken;
      beams.push({ laser: index, from, to, asteroidId: null, resource: m.resource, bonus: 1, vein: null, grade: m.grade, mover: m.id });
      if (taken > 0) {
        const ore = splitOre(m.mix, taken * m.grade);
        for (const r of RESOURCE_IDS) cargo[r] += ore[r] ?? 0;
        free -= taken * m.grade;
        mined += taken * m.grade;
        moverExtractions.push({ laser: index, mover: m.id, before, taken, ore, grade: m.grade, to, laserRate: laser.rate * yieldMultiplier });
      }
      continue;
    }
    if (!hit) {
      beams.push({ laser: index, from, to: add(from, scale(dir, laser.range)), asteroidId: null, resource: null, bonus: 1, vein: null });
      continue;
    }
    const { asteroid, circle } = candidates[hit.index]!;
    // the beam ends under the cursor when the cursor lies on this rock (aiming at a vein), else at the rim
    const aimDistance = length(sub(aim, from));
    const onRock = length(sub(aim, circle.pos)) < circle.radius && aimDistance > hit.distance && aimDistance <= laser.range;
    const to = onRock ? { x: aim.x, y: aim.y } : add(from, scale(dir, hit.distance));

    let bonus = 1;
    let vein: MiningBeam['vein'] = null;
    let entry = minedRocks.get(asteroid.id);
    if (!entry) {
      entry = { asteroid, onSegment: [] };
      minedRocks.set(asteroid.id, entry);
    }
    if (veinsOf(asteroid).length > 0) {
      const veinHit = findVeinHit(asteroid, circle.radius, time, world.veinState(asteroid), to);
      if (veinHit) {
        bonus = veinBonus(veinHit.type, laser.heavy) * (params.veinMultiplier ?? 1);
        vein = { index: veinHit.vein, u: veinHit.u };
        onVein.push(laser.partId);
        entry.onSegment[veinHit.vein] = (entry.onSegment[veinHit.vein] ?? 0) + 1;
      }
    }
    const grade = params.gradeOf ? params.gradeOf(asteroid) : 1;
    beams.push({ laser: index, from, to, asteroidId: asteroid.id, resource: asteroid.resource, bonus, vein, grade });

    // rock units come out of the asteroid, ore = rock × grade goes into the hold
    const before = world.remaining(asteroid);
    const taken = world.extract(asteroid, Math.min(laser.rate * dt * yieldMultiplier * bonus, Math.max(0, free) / grade));
    const ore = taken * grade;
    cargo[asteroid.resource] += ore;
    free -= ore;
    mined += ore;
    if (taken > 0) {
      extractions.push({ laser: index, asteroid, before, taken, grade, bonus, onVein: vein !== null, to, laserRate: laser.rate * yieldMultiplier });
    }
    const left = world.remaining(asteroid);
    if (shouldCrack(asteroid, left)) {
      // ice cracks into fragments at 30 % (spec 2.1.1)
      const before = circle.radius;
      const fragments = world.crack(asteroid);
      circle.radius = 0;
      cracked.push({ id: asteroid.id, pos: { ...asteroid.pos }, radius: before, fragments: fragments.map((f) => f.id) });
    } else if (left <= 0) {
      // a depleted asteroid has radius 0 in the cache, the next laser no longer hits it
      depleted.push(asteroid.id);
    }
  }

  // active segments of mined veins drift (two lasers on one segment = 2× faster)
  for (const { asteroid, onSegment } of minedRocks.values()) {
    const radius = world.radiusOf(asteroid);
    if (radius <= 0) continue;
    const drifting = veinsOf(asteroid).filter(veinDrifts);
    if (drifting.length === 0) continue;
    const state = world.mutableVeinState(asteroid);
    for (const v of drifting) {
      const du = (VEIN_DRIFT_SPEED * Math.max(1, onSegment[v.index] ?? 0) * dt) / veinWorldLength(v, radius);
      advanceVein(v, radius, state, du);
    }
  }

  return { beams, energyUsed: params.energy - energy, mined, cargoFilled: hadSpace && free <= 1e-9, depleted, onVein, cracked, extractions, moverExtractions };
}

/** The cursor on or within `MOVER_LOCK` of a mover's rim (but not inside a large one) aims at its centre. */
const MOVER_LOCK = 1.5;

function moverLock(movers: readonly MiningMover[], aim: Vec2): Vec2 | null {
  let best: MiningMover | null = null;
  let bestGap = MOVER_LOCK;
  for (const m of movers) {
    const gap = length(sub(aim, m.pos)) - m.radius;
    // inside a big target the beam goes where the cursor is (like on a rock)
    if (gap < 0 && m.radius > MOVER_LOCK * 2) continue;
    if (gap <= bestGap) {
      best = m;
      bestGap = gap;
    }
  }
  return best ? best.pos : null;
}

/** Ore of `amount` cargo units split by a mix (shares sum to 1), in resource order. */
function splitOre(mix: MiningMover['mix'], amount: number): Partial<Cargo> {
  const out: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) {
    const share = mix[r];
    if (share) out[r] = amount * share;
  }
  return out;
}
