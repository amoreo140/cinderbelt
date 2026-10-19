import { hypot, type Vec2 } from '../math/vec2';
import type { Body } from './body';

export interface Circle {
  pos: Vec2;
  radius: number;
  /** Hitting this obstacle never damages the ship (stations – docking stays safe, M21). */
  safe?: boolean;
  /**
   * Velocity of a moving obstacle (M4b: a comet nucleus, sim/sites/comets.ts). The impact uses the
   * relative velocity: a 50 u/s nucleus hitting a parked ship hurts, flying alongside it does not.
   */
  vel?: Vec2;
}

/** A ship cell counts as a circle of this radius in collisions. */
export const CELL_RADIUS = 0.5;

export interface CollisionResult {
  body: Body;
  /** Largest impact speed along the normal (0 = no impact). */
  impactSpeed: number;
  /** Hardest impact into an obstacle that is not `safe` (0 = none) – for ram damage. */
  hardImpact: number;
  /** The cell (an element of cellOffsets) that took the hardest impact `hardImpact`, else null. */
  hardCell: Vec2 | null;
  /** World point on the obstacle's surface where the strongest impact landed (sparks – M3.8), or null. */
  contact: Vec2 | null;
}

/**
 * Pushes the ship out of the obstacle circles and bounces its velocity. A moving obstacle (`vel`) bounces
 * the velocity relative to it and its impact speed is the relative one.
 */
export function resolveCollisions(
  body: Body,
  cellOffsets: readonly Vec2[],
  boundingRadius: number,
  obstacles: readonly Circle[],
  restitution = 0.3,
): CollisionResult {
  // scalars instead of Vec2 temporaries (perf audit 2026-10-17, P4); the arithmetic is the one of
  // add/sub/scale/rotate/dot, operation for operation, so the results are bit-identical
  let px = body.pos.x;
  let py = body.pos.y;
  let vx = body.vel.x;
  let vy = body.vel.y;
  let impactSpeed = 0;
  let hardImpact = 0;
  let hardCell: Vec2 | null = null;
  let contact: Vec2 | null = null;
  let touched = false;
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);

  // indexed loops: no iterator objects while this hot function is not optimized yet (cold JIT)
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]!;
    if (o.radius <= 0) continue;
    const reach = boundingRadius + o.radius + CELL_RADIUS;
    const ox = o.pos.x;
    const oy = o.pos.y;
    const dx0 = px - ox;
    const dy0 = py - oy;
    if (dx0 * dx0 + dy0 * dy0 > reach * reach) continue;

    const minDist = o.radius + CELL_RADIUS;
    for (let k = 0; k < cellOffsets.length; k++) {
      const offset = cellOffsets[k]!;
      const dx = px + (offset.x * c - offset.y * s) - ox;
      const dy = py + (offset.x * s + offset.y * c) - oy;
      const dist = hypot(dx, dy);
      if (dist >= minDist) continue;
      let nx = 1;
      let ny = 0;
      if (dist > 1e-9) {
        const inv = 1 / dist;
        nx = dx * inv;
        ny = dy * inv;
      }
      const push = minDist - dist;
      px = px + nx * push;
      py = py + ny * push;
      touched = true;
      const vn = o.vel ? (vx - o.vel.x) * nx + (vy - o.vel.y) * ny : vx * nx + vy * ny;
      if (vn < 0) {
        const k = vn * (1 + restitution);
        vx = vx - nx * k;
        vy = vy - ny * k;
        if (-vn > impactSpeed) {
          impactSpeed = -vn;
          contact = { x: ox + nx * o.radius, y: oy + ny * o.radius };
        }
        if (!o.safe && -vn > hardImpact) {
          hardImpact = -vn;
          hardCell = offset;
        }
      }
    }
  }

  if (!touched) return { body, impactSpeed: 0, hardImpact: 0, hardCell: null, contact: null };
  return { body: { ...body, pos: { x: px, y: py }, vel: { x: vx, y: vy } }, impactSpeed, hardImpact, hardCell, contact };
}
