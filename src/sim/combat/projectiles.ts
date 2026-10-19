// Projectile flight (M3a): every step a segment pos → pos + vel·dt. The nearest hit among asteroids,
// stations, wrecks and ships (the shield is a bubble around the ship, else the first cell of the grid
// via DDA – polygon-aware for shaped cells, SL2 E2 spec §2.4).
import { clearList } from '../scratch';
import { add, hypot, length, scale, sub, type Vec2 } from '../math/vec2';
import { raycastCircles } from '../mining/laser';
import type { Body } from '../physics/body';
import type { Circle } from '../physics/collide';
import type { ShipProperties } from '../ship/properties';
import { currentHp } from '../ship/hp';
import type { ShipGrid } from '../ship/types';
import type { AsteroidCircle } from '../world/World';
import { gridToWorld, raycastShip, segmentCircle, worldToGrid } from './geometry';
import { PLAYER_REF, type CombatShip, type Projectile, type ShipRef, type Wreck } from './types';

/** The shield bubble reaches this far beyond the ship's hull. */
export const SHIELD_MARGIN = 0.8;
export const shieldRadius = (props: ShipProperties): number => props.boundingRadius + SHIELD_MARGIN;

export interface ShipTarget {
  ref: ShipRef;
  ship: CombatShip;
}

export type ProjectileHit =
  | {
      kind: 'ship';
      projectile: Projectile;
      ref: ShipRef;
      /** Hit point (on the shield bubble, or on the cell / the shape's edge). */
      pos: Vec2;
      /** Part that takes the damage past the shield (null = the shot would pass through a gap). */
      partId: number | null;
      /** A hit on the shield bubble. */
      shielded: boolean;
    }
  | { kind: 'wreck'; projectile: Projectile; wreckId: number; pos: Vec2 }
  | { kind: 'asteroid'; projectile: Projectile; asteroidId: string; pos: Vec2 }
  | { kind: 'station'; projectile: Projectile; pos: Vec2 };

export interface ProjectileWorld {
  circlesNear(pos: Vec2, radius: number): AsteroidCircle[];
  stationCirclesNear(pos: Vec2, radius: number): Circle[];
}

interface Candidate {
  t: number;
  hit: ProjectileHit;
}

/** First hit on the grid's parts along the segment (world coordinates) – t ∈ [0, 1] and the part id. */
function gridHit(grid: ShipGrid, props: ShipProperties, body: Body, from: Vec2, to: Vec2): { t: number; partId: number } | null {
  const hit = raycastShip(grid, worldToGrid(body, props.centerOfMass, from), worldToGrid(body, props.centerOfMass, to));
  return hit ? { t: hit.t, partId: hit.partId } : null;
}

function nearCircle(from: Vec2, to: Vec2, center: Vec2, radius: number): boolean {
  const dx = center.x - from.x;
  const dy = center.y - from.y;
  if (dx * dx + dy * dy <= radius * radius) return true;
  return segmentCircle(from, to, center, radius) !== null;
}

function shipCandidate(p: Projectile, from: Vec2, to: Vec2, target: ShipTarget): Candidate | null {
  const { ship, ref } = target;
  const { body, props } = ship;
  const shieldUp = ship.shield > 0 && props.shield.capacity > 0;
  if (shieldUp) {
    const r = shieldRadius(props);
    const t = segmentCircle(from, to, body.pos, r);
    if (t !== null) {
      const pos = add(from, scale(sub(to, from), t));
      // damage the shield cannot hold goes to the first part behind the bubble
      const dir = sub(to, from);
      const len = length(dir);
      const beyond = len > 1e-9 ? add(pos, scale(dir, (2 * r) / len)) : pos;
      const cell = gridHit(ship.grid, props, body, pos, beyond);
      return { t, hit: { kind: 'ship', projectile: p, ref, pos, partId: cell?.partId ?? null, shielded: true } };
    }
  }
  if (!nearCircle(from, to, body.pos, props.boundingRadius + 0.1)) return null;
  const cell = gridHit(ship.grid, props, body, from, to);
  if (!cell) return null;
  const pos = add(from, scale(sub(to, from), cell.t));
  // a shot fired from inside the bubble (point blank) does not hit the bubble, but the shield still absorbs it (M18)
  const inside = shieldUp && length(sub(from, body.pos)) < shieldRadius(props);
  return { t: cell.t, hit: { kind: 'ship', projectile: p, ref, pos, partId: cell.partId, shielded: inside } };
}

/**
 * The part a shot goes on to from a destroyed part (M19): the first live part on the ray from `from`
 * along `vel` (parts with 0 HP are skipped, shaped cells by their polygon). Null = the shot went
 * through a hole.
 */
export function nextLivePart(ship: CombatShip, from: Vec2, vel: Vec2): number | null {
  const len = length(vel);
  if (len < 1e-9) return null;
  const alive = new Set(ship.grid.parts.filter((x) => currentHp(ship.hp, x) > 0).map((x) => x.id));
  const to = add(from, scale(vel, (2 * ship.props.boundingRadius + 2) / len));
  const { body, props } = ship;
  return raycastShip(ship.grid, worldToGrid(body, props.centerOfMass, from), worldToGrid(body, props.centerOfMass, to), alive)?.partId ?? null;
}

function wreckCandidate(p: Projectile, from: Vec2, to: Vec2, w: Wreck): Candidate | null {
  if (!nearCircle(from, to, w.body.pos, w.props.boundingRadius + 0.1)) return null;
  const cell = gridHit(w.grid, w.props, w.body, from, to);
  if (!cell) return null;
  return { t: cell.t, hit: { kind: 'wreck', projectile: p, wreckId: w.id, pos: add(from, scale(sub(to, from), cell.t)) } };
}

/**
 * The hit rule before M4d: a ship never hits itself; enemy shots do not hit enemies (only the player);
 * the player's shots hit every enemy. The default predicate of `stepProjectiles` (the M4d side rules,
 * src/sim/npc/sides.ts `canHit`, extend it for the Guild Watch and convoys).
 */
export const defaultCanHit = (owner: ShipRef, target: ShipRef): boolean => target !== owner && (owner === PLAYER_REF || target === PLAYER_REF);

/** The nearer of two candidates (the first on a tie), like the old `consider`. */
const better = (best: Candidate | null, c: Candidate | null): Candidate | null => (c && (!best || c.t < best.t) ? c : best);

/** Scratch of `stepProjectiles`. */
const DIR: Vec2 = { x: 0, y: 0 };
const MID: Vec2 = { x: 0, y: 0 };
const ROCK_CIRCLES: Circle[] = [];

/**
 * Moves the projectiles one step. Returns those that fly on and the hits in projectile order. A ship is
 * a candidate only when `canHit(owner, ship)` (default: enemy shots hit only the player, the player's
 * shots every enemy, never the owner itself).
 */
export function stepProjectiles(
  projectiles: readonly Projectile[],
  ships: readonly ShipTarget[],
  wrecks: readonly Wreck[],
  world: ProjectileWorld,
  dt: number,
  canHit: (owner: ShipRef, target: ShipRef) => boolean = defaultCanHit,
): { alive: Projectile[]; hits: ProjectileHit[] } {
  const alive: Projectile[] = [];
  const hits: ProjectileHit[] = [];
  // scratch vectors and lists (the world queries and raycasts keep none) – the arithmetic is that of
  // add/sub/scale/length, operation for operation (perf audit 2026-10-17, P4)
  const dir = DIR;
  const mid = MID;
  for (const p of projectiles) {
    const from = p.pos;
    const to = { x: from.x + p.vel.x * dt, y: from.y + p.vel.y * dt };
    const sx = to.x - from.x;
    const sy = to.y - from.y;
    const len = hypot(sx, sy);
    let best: Candidate | null = null;

    if (len > 1e-9) {
      const inv = 1 / len;
      dir.x = sx * inv;
      dir.y = sy * inv;
      mid.x = from.x + sx * 0.5;
      mid.y = from.y + sy * 0.5;
      const rocks = world.circlesNear(mid, len / 2 + 0.5);
      if (rocks.length > 0) {
        const circles = ROCK_CIRCLES;
        clearList(circles);
        for (const r of rocks) circles.push(r.circle);
        const rock = raycastCircles(from, dir, len, circles);
        clearList(circles);
        if (rock) {
          best = better(best, {
            t: rock.distance / len,
            hit: { kind: 'asteroid', projectile: p, asteroidId: rocks[rock.index]!.asteroid.id, pos: { x: from.x + dir.x * rock.distance, y: from.y + dir.y * rock.distance } },
          });
        }
      }
      const station = raycastCircles(from, dir, len, world.stationCirclesNear(mid, len / 2 + 0.5));
      if (station) best = better(best, { t: station.distance / len, hit: { kind: 'station', projectile: p, pos: { x: from.x + dir.x * station.distance, y: from.y + dir.y * station.distance } } });
    }
    for (const target of ships) {
      if (!canHit(p.owner, target.ref)) continue;
      best = better(best, shipCandidate(p, from, to, target));
    }
    for (const w of wrecks) best = better(best, wreckCandidate(p, from, to, w));

    const hit = best?.hit;
    if (hit) {
      hits.push(hit);
      continue;
    }
    if (p.ttl > 1) alive.push({ ...p, pos: to, ttl: p.ttl - 1 });
  }
  return { alive, hits };
}

/** World position of a ship cell's centre (effects and tests). */
export const cellWorld = (ship: Pick<CombatShip, 'body' | 'props'>, cell: Vec2): Vec2 =>
  gridToWorld(ship.body, ship.props.centerOfMass, cell);
