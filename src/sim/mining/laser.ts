import { dot, length, scale, sub, type Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';

/** A laser aims at most 60° from the direction the part is facing. */
export const LASER_HALF_ARC = Math.PI / 3;

export interface RayHit {
  index: number;
  distance: number;
}

/** The nearest beam hit (dir must be a unit vector) among circles within maxDistance. */
export function raycastCircles(
  origin: Vec2,
  dir: Vec2,
  maxDistance: number,
  circles: readonly Circle[],
): RayHit | null {
  let best: RayHit | null = null;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i]!;
    if (c.radius <= 0) continue;
    const m = sub(origin, c.pos);
    const b = dot(m, dir);
    const k = dot(m, m) - c.radius * c.radius;
    let t: number;
    if (k <= 0) {
      t = 0; // the beam starts inside the circle
    } else {
      if (b > 0) continue;
      const disc = b * b - k;
      if (disc < 0) continue;
      t = -b - Math.sqrt(disc);
    }
    if (t <= maxDistance && (!best || t < best.distance)) best = { index: i, distance: t };
  }
  return best;
}

/** A unit direction to the target, or null if it is outside the allowed arc. */
export function aimDirection(from: Vec2, facing: Vec2, target: Vec2): Vec2 | null {
  const d = sub(target, from);
  const len = length(d);
  if (len < 1e-6) return facing;
  const dir = scale(d, 1 / len);
  if (dot(dir, facing) < Math.cos(LASER_HALF_ARC)) return null;
  return dir;
}
