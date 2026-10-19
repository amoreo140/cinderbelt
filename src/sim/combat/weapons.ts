// Cannons (M3a): an arc of ±60° from the part's facing (effective arcs: arcs.ts), a fire rate, energy per
// shot, projectiles with the ship's velocity + the shot's speed.
import { add, hypot, length, rotate, sub, type Vec2 } from '../math/vec2';
import { TICKS_PER_SECOND } from './damage';
import type { CombatShip, Projectile, ShipRef } from './types';
import { CANNON_HALF_ARC, inArcs, type Arc } from './arcs';

/** A cannon aims at most ±60° from its facing (user decision 2026-10-17), minus its own hull (arcs.ts). */
export { CANNON_HALF_ARC };
/** A shot starts at the muzzle – a little ahead of the part's centre. */
export const MUZZLE_OFFSET = 0.5;

/**
 * Unit direction to the target, or null when it is outside the cannon's arc. With `arcs` (effective
 * arcs relative to the facing) the direction must lie in one of them – the own hull blocks the rest.
 */
export function cannonDirection(from: Vec2, facing: Vec2, target: Vec2, arcs?: readonly Arc[]): Vec2 | null {
  const r = cannonDir(from.x, from.y, facing.x, facing.y, target, arcs);
  if (r === BLOCKED) return null;
  return r === FACING ? facing : { x: DIR.x, y: DIR.y };
}

const BLOCKED = 0;
const FACING = 1;
const AIMED = 2;
/** The direction of `cannonDir` when it answers AIMED (read right away). */
const DIR: Vec2 = { x: 0, y: 0 };

/**
 * `cannonDirection` without objects: BLOCKED (null), FACING (the facing itself – the target sits on the
 * muzzle) or AIMED (the unit direction in `DIR`). The arithmetic of sub/length/scale/dot, operation for
 * operation (perf audit 2026-10-17, P4).
 */
function cannonDir(fx: number, fy: number, facingX: number, facingY: number, target: Vec2, arcs?: readonly Arc[]): number {
  const dx = target.x - fx;
  const dy = target.y - fy;
  const len = hypot(dx, dy);
  if (len < 1e-6) return arcs && arcs.length === 0 ? BLOCKED : FACING;
  const inv = 1 / len;
  const ux = dx * inv;
  const uy = dy * inv;
  if (arcs) {
    const angle = Math.atan2(facingX * uy - facingY * ux, facingX * ux + facingY * uy);
    if (!inArcs(arcs, angle)) return BLOCKED;
  } else if (ux * facingX + uy * facingY < Math.cos(CANNON_HALF_ARC) - 1e-9) {
    return BLOCKED;
  }
  DIR.x = ux;
  DIR.y = uy;
  return AIMED;
}

/** How many cannons of the ship could hit `aim` now (in arc and range) out of all cannons. */
export function cannonsCovering(ship: Pick<CombatShip, 'body' | 'props'>, aim: Vec2): { covering: number; total: number } {
  let covering = 0;
  for (const w of ship.props.weapons) {
    const center = add(ship.body.pos, rotate(w.offset, ship.body.angle));
    const dir = cannonDirection(center, rotate(w.facing, ship.body.angle), aim, w.arcs);
    if (dir && length(sub(aim, center)) <= w.range) covering++;
  }
  return { covering, total: ship.props.weapons.length };
}

/** Counts the cannons' reload down by one step. */
export function tickCooldowns(ship: CombatShip): void {
  for (const [id, left] of ship.cooldowns) {
    if (left <= 1) ship.cooldowns.delete(id);
    else ship.cooldowns.set(id, left - 1);
  }
}

/**
 * Fires every loaded cannon whose arc covers `aim` and that has the energy. `ids` gives the projectile
 * ids (nextId moves on). No ready cannon: a shared empty list (read-only).
 */
export function fireWeapons(ship: CombatShip, owner: ShipRef, aim: Vec2, ids: { nextId: number }): Projectile[] {
  let shots: Projectile[] | null = null;
  const { body } = ship;
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);
  for (const w of ship.props.weapons) {
    if ((ship.cooldowns.get(w.partId) ?? 0) > 0) continue;
    if (ship.energy < w.energyPerShot) continue;
    // add(body.pos, rotate(w.offset, angle)) and rotate(w.facing, angle) as scalars
    const cx = body.pos.x + (w.offset.x * c - w.offset.y * s);
    const cy = body.pos.y + (w.offset.x * s + w.offset.y * c);
    const facingX = w.facing.x * c - w.facing.y * s;
    const facingY = w.facing.x * s + w.facing.y * c;
    const r = cannonDir(cx, cy, facingX, facingY, aim, w.arcs);
    if (r === BLOCKED) continue;
    const dx = r === FACING ? facingX : DIR.x;
    const dy = r === FACING ? facingY : DIR.y;
    ship.energy -= w.energyPerShot;
    ship.cooldowns.set(w.partId, Math.max(1, Math.round(TICKS_PER_SECOND / w.fireRate)));
    const pos = { x: cx + dx * MUZZLE_OFFSET, y: cy + dy * MUZZLE_OFFSET };
    (shots ??= []).push({
      id: ids.nextId++,
      owner,
      pos,
      vel: { x: body.vel.x + dx * w.projectileSpeed, y: body.vel.y + dy * w.projectileSpeed },
      ttl: Math.ceil((w.range / w.projectileSpeed) * TICKS_PER_SECOND),
      damage: w.damage,
      tier: w.tier,
      origin: pos,
    });
  }
  return shots ?? NO_SHOTS;
}

/** No shot this step (frozen: the callers only read it). */
const NO_SHOTS = Object.freeze([]) as unknown as Projectile[];

/**
 * The point to aim at so that a shot (the shooter's velocity + `speed` in the aimed direction) hits a target
 * moving steadily in a straight line. No hit possible → the target's position.
 */
export function leadPoint(shooter: Vec2, shooterVel: Vec2, target: Vec2, targetVel: Vec2, speed: number): Vec2 {
  leadInto(shooter.x, shooter.y, target.x, target.y, targetVel.x - shooterVel.x, targetVel.y - shooterVel.y, speed, LEAD);
  return { x: LEAD.x, y: LEAD.y };
}

/** Scratch answer of `leadInto`. */
const LEAD: Vec2 = { x: 0, y: 0 };

/**
 * `leadPoint` with scalars, written into `out`: (vx, vy) is the target's velocity relative to the
 * shooter. The arithmetic of sub/dot/add/scale, operation for operation.
 */
export function leadInto(sx: number, sy: number, tx: number, ty: number, vx: number, vy: number, speed: number, out: Vec2): Vec2 {
  const rx = tx - sx;
  const ry = ty - sy;
  const a = vx * vx + vy * vy - speed * speed;
  const b = 2 * (rx * vx + ry * vy);
  const c = rx * rx + ry * ry;
  let t: number;
  if (Math.abs(a) < 1e-9) {
    t = b < 0 ? -c / b : -1;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) {
      out.x = tx;
      out.y = ty;
      return out;
    }
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a);
    const t2 = (-b + s) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0)) {
    out.x = tx;
    out.y = ty;
    return out;
  }
  out.x = tx + vx * t;
  out.y = ty + vy * t;
  return out;
}
