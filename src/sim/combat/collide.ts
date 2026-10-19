// Collisions of two moving bodies (ship–ship, ship–wreck; spec 3.6 – decided in M3a).
// Cells are circles of radius ½. The deepest overlap is resolved: the bodies move apart by their
// masses and get an impulse along the normal (no rotation – simplified like the asteroids).
import { hypot, type Vec2 } from '../math/vec2';
import type { Body } from '../physics/body';
import { CELL_RADIUS } from '../physics/collide';

export interface Collider {
  body: Body;
  cellOffsets: readonly Vec2[];
  boundingRadius: number;
  mass: number;
}

export interface PairResult {
  a: Body;
  b: Body;
  /** Impact speed along the normal (0 = they only touch). */
  impactSpeed: number;
  /** Cells in the deepest contact (elements of the cellOffsets of a, b) – for the ram damage. */
  cellA: Vec2;
  cellB: Vec2;
}

/** World cell centres of body b (`collidePair` scratch, grown on demand). */
let BX = new Float64Array(64);
let BY = new Float64Array(64);

/**
 * Resolves the overlap of two bodies; null = they do not touch. Scalars and a scratch buffer instead of
 * Vec2 temporaries (perf audit 2026-10-17, P4) – the arithmetic is the one of add/sub/scale/rotate/dot,
 * operation for operation, so the results are bit-identical. `a` and `b` are not kept (callers may pass
 * reused scratch colliders).
 */
export function collidePair(a: Collider, b: Collider, restitution = 0.3): PairResult | null {
  const reach = a.boundingRadius + b.boundingRadius + 2 * CELL_RADIUS;
  const ap = a.body.pos;
  const bp = b.body.pos;
  const dx0 = ap.x - bp.x;
  const dy0 = ap.y - bp.y;
  if (dx0 * dx0 + dy0 * dy0 > reach * reach) return null;

  const minDist = 2 * CELL_RADIUS;
  const bOffsets = b.cellOffsets;
  const nb = bOffsets.length;
  if (BX.length < nb) {
    BX = new Float64Array(nb * 2);
    BY = new Float64Array(nb * 2);
  }
  const bc = Math.cos(b.body.angle);
  const bs = Math.sin(b.body.angle);
  for (let j = 0; j < nb; j++) {
    const o = bOffsets[j]!;
    BX[j] = bp.x + (o.x * bc - o.y * bs);
    BY[j] = bp.y + (o.x * bs + o.y * bc);
  }
  const ac = Math.cos(a.body.angle);
  const as = Math.sin(a.body.angle);
  let depth = 0;
  let nx = 1;
  let ny = 0;
  let cellA: Vec2 | null = null;
  let cellB: Vec2 | null = null;
  for (const o of a.cellOffsets) {
    const cax = ap.x + (o.x * ac - o.y * as);
    const cay = ap.y + (o.x * as + o.y * ac);
    for (let j = 0; j < nb; j++) {
      const dx = cax - BX[j]!;
      const dy = cay - BY[j]!;
      const dist = hypot(dx, dy);
      if (dist >= minDist || minDist - dist <= depth) continue;
      depth = minDist - dist;
      if (dist > 1e-9) {
        const inv = 1 / dist;
        nx = dx * inv;
        ny = dy * inv;
      } else {
        nx = 1;
        ny = 0;
      }
      cellA = o;
      cellB = bOffsets[j]!;
    }
  }
  if (depth <= 0) return null;

  const total = a.mass + b.mass;
  const kA = (depth * b.mass) / total;
  const kB = (depth * a.mass) / total;
  const posA = { x: ap.x + nx * kA, y: ap.y + ny * kA };
  const posB = { x: bp.x - nx * kB, y: bp.y - ny * kB };
  let velA = a.body.vel;
  let velB = b.body.vel;
  const vrel = (velA.x - velB.x) * nx + (velA.y - velB.y) * ny;
  let impactSpeed = 0;
  if (vrel < 0) {
    const j = (-(1 + restitution) * vrel) / (1 / a.mass + 1 / b.mass);
    const jA = j / a.mass;
    const jB = j / b.mass;
    velA = { x: velA.x + nx * jA, y: velA.y + ny * jA };
    velB = { x: velB.x - nx * jB, y: velB.y - ny * jB };
    impactSpeed = -vrel;
  }
  return { a: { ...a.body, pos: posA, vel: velA }, b: { ...b.body, pos: posB, vel: velB }, impactSpeed, cellA: cellA!, cellB: cellB! };
}
