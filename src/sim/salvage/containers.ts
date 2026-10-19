// Cargo containers (long-term design 5.3 "Container / pod", M3.6): by the larger POI wrecks, in the
// scavengers' loot and in the war chest. They drift like wrecks, the tractor beam pulls them in and
// F loads them.
import type { RingIndex } from '../../data/economy';
import { partKey, type PartInventory } from '../../data/parts';
import { CONTAINER_CARGO, CONTAINER_PART_CHANCE, CONTAINER_RADIUS, CONTAINER_TTL } from '../../data/salvage';
import { RETRIEVE_PARTS } from '../../data/contracts';
import { emptyCargo, type ResourceId } from '../../data/resources';
import type { Collider } from '../combat/collide';
import type { Container, WreckLoot } from '../combat/types';
import { fnv1a32 } from '../math/fnv1a';
import { createRng } from '../math/rng';
import type { Vec2 } from '../math/vec2';
import { driftDamped, type Body } from '../physics/body';
import { resolveCollisions, type Circle } from '../physics/collide';
import { hash3 } from '../world/hash';

const CONTAINER_SALT = 0x0c0a_7a1e;
const LINEAR_DAMPING = 0.12;
const ANGULAR_DAMPING = 0.25;
const ONE_CELL: readonly Vec2[] = [{ x: 0, y: 0 }];

/** Negative container id from its key (`ct:<poi>:<i>`) – does not take from the combat numbering. */
export const poiContainerId = (key: string): number => -(1 + (fnv1a32(key) & 0x3fffffff));

export function createContainer(id: number, pos: Vec2, vel: Vec2, loot: WreckLoot, ttl = CONTAINER_TTL, angle = 0): Container {
  const body: Body = { pos: { ...pos }, vel: { ...vel }, angle, angVel: 0.25 };
  return { id, body, prevBody: body, loot, ttl };
}

/** A container's cargo from its key: resources of the ring and sometimes a part (deterministic). */
export function containerLoot(key: string, ring: RingIndex): WreckLoot {
  const rng = createRng(hash3(CONTAINER_SALT, fnv1a32(key), 1));
  const cargo = emptyCargo();
  const res: ResourceId[] = ring >= 2 ? ['titanium', 'copper', 'iron'] : ['iron', 'copper', 'ice'];
  const [lo, hi] = CONTAINER_CARGO;
  const total = lo + rng() * (hi - lo);
  const main = res[Math.floor(rng() * res.length)]!;
  cargo[main] = Math.round(total * 0.7);
  const second = res[(res.indexOf(main) + 1) % res.length]!;
  cargo[second] = Math.round(total * 0.3);
  const parts: PartInventory = {};
  if (rng() < CONTAINER_PART_CHANCE) {
    const id = RETRIEVE_PARTS[Math.floor(rng() * RETRIEVE_PARTS.length)]!;
    parts[partKey(id, ring >= 3 ? 2 : 1)] = 1;
  }
  return { cargo, parts };
}

/** One drift step of a container (like a wreck: light damping, bouncing off rocks). */
export function stepContainer(c: Container, obstacles: readonly Circle[], dt: number): void {
  c.prevBody = c.body;
  const damped = driftDamped(c.body, dt, LINEAR_DAMPING, ANGULAR_DAMPING);
  c.body = obstacles.length > 0 ? resolveCollisions(damped, ONE_CELL, CONTAINER_RADIUS, obstacles).body : damped;
  c.ttl--;
}

const CONTAINER_MASS = 1.5;

/** Collision data of a container (one cell). */
export const containerCollider = (c: Container): Collider => ({ body: c.body, cellOffsets: ONE_CELL, boundingRadius: CONTAINER_RADIUS, mass: CONTAINER_MASS });

/** `containerCollider` written into a reused collider (the per-pair loop of `collideAll`). */
export function containerColliderInto(out: Collider, c: Container): Collider {
  out.body = c.body;
  out.cellOffsets = ONE_CELL;
  out.boundingRadius = CONTAINER_RADIUS;
  out.mass = CONTAINER_MASS;
  return out;
}
