// Effective cannon arcs (user decision 2026-10-17): a cannon covers ±60° around its facing, minus
// every direction whose ray from the cannon passes through another cell of its own ship – a cannon
// never fires into its own hull. Computed with the ship properties (recomputed on grid changes);
// pirates follow the same rule. Shaped armour (SL2 E2) blocks with its real cell polygon, so a shape
// beside or diagonal to a cannon trims less than a full cell; a shape right in front still blocks the axis.
import { facing, partCells, partCenter } from '../ship/grid';
import { cellPolygon, segmentPolygonEntry, type Poly } from '../ship/shape';
import type { PlacedPart, ShipGrid } from '../ship/types';
import { rotate, type Vec2 } from '../math/vec2';

/** Half of the full cannon arc (rad). */
export const CANNON_HALF_ARC = Math.PI / 3;
/** Sampling step of the effective arc (rad, 2°). */
export const ARC_STEP = Math.PI / 90;
/** Half size of a blocking cell (touching cells leave no diagonal gap to shoot through). */
const CELL_HALF = 0.5;
/** Slivers narrower than this are dropped (a gap the gun could never really use). */
const MIN_ARC = 2 * ARC_STEP;
/** Ray length (the hangar grid is −7…7, so 30 leaves any ship). */
const RAY = 30;

/** An interval [from, to] of angles relative to the cannon facing (rad, from ≤ to). */
export type Arc = readonly [number, number];

/** One slab of `rayHitsCell`: narrows [t0, t1] (in `SLAB`); false when the ray misses the slab. */
const SLAB = { t0: 0, t1: 0 };
function slab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-12) return !(o < lo || o > hi);
  let a = (lo - o) / d;
  let b = (hi - o) / d;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  SLAB.t0 = Math.max(SLAB.t0, a);
  SLAB.t1 = Math.min(SLAB.t1, b);
  return !(SLAB.t0 > SLAB.t1);
}

/** Does the ray origin + t·dir (0 < t ≤ RAY) hit the axis-aligned square around `c`? (slab test, no allocation) */
function rayHitsCell(ox: number, oy: number, dx: number, dy: number, c: Vec2): boolean {
  SLAB.t0 = 1e-6;
  SLAB.t1 = RAY;
  return slab(ox, dx, c.x - CELL_HALF, c.x + CELL_HALF) && slab(oy, dy, c.y - CELL_HALF, c.y + CELL_HALF);
}

/**
 * Does the ray hit the cell polygon of a shaped part? Same semantics as the slab test: the boundary is
 * solid (a grazing ray is blocked), the ray is RAY long and a polygon around the origin blocks.
 */
function rayHitsPoly(origin: Vec2, dir: Vec2, poly: Poly): boolean {
  return segmentPolygonEntry(origin, { x: origin.x + dir.x * RAY, y: origin.y + dir.y * RAY }, poly) !== null;
}

/** Is the direction at `angle` (relative to the facing) blocked by another cell of the ship? */
function blocked(origin: Vec2, base: Vec2, angle: number, cells: readonly Vec2[], polys: readonly Poly[]): boolean {
  const dir = rotate(base, angle);
  for (const c of cells) if (rayHitsCell(origin.x, origin.y, dir.x, dir.y, c)) return true;
  for (const poly of polys) if (rayHitsPoly(origin, dir, poly)) return true;
  return false;
}

const cache = new WeakMap<ShipGrid, Map<number, Arc[]>>();

/**
 * Effective arcs of the cannon `part` on `grid`: the sampled directions within ±half that leave the
 * ship without crossing another part, merged into intervals. Empty = the cannon is walled in.
 */
export function effectiveArcs(grid: ShipGrid, part: PlacedPart, half = CANNON_HALF_ARC): Arc[] {
  let byPart = cache.get(grid);
  if (!byPart) {
    byPart = new Map();
    cache.set(grid, byPart);
  }
  const hit = byPart.get(part.id);
  if (hit && half === CANNON_HALF_ARC) return hit;
  const own = new Set(partCells(part).map((c) => `${c.x},${c.y}`));
  // Full cells keep the square slab test (unshaped grids: bit-identical); a shaped part's partial cells
  // block by their polygon, its fully solid cells as squares, its empty cells not at all.
  const cells: Vec2[] = [];
  const polys: Poly[] = [];
  for (const p of grid.parts) {
    if (p.id === part.id) continue;
    for (const c of partCells(p)) {
      if (own.has(`${c.x},${c.y}`)) continue;
      const poly = p.shape === undefined ? null : cellPolygon(p, c);
      if (poly === null) cells.push(c);
      else if (poly.length >= 3) polys.push(poly);
    }
  }
  const origin = partCenter(part);
  const base = facing(part.rot);
  const steps = Math.round((2 * half) / ARC_STEP);
  const out: [number, number][] = [];
  let start: number | null = null;
  let last = 0;
  for (let k = 0; k <= steps; k++) {
    const a = -half + (k * 2 * half) / steps;
    if (!blocked(origin, base, a, cells, polys)) {
      if (start === null) start = a;
      last = a;
    } else if (start !== null) {
      out.push([start, last]);
      start = null;
    }
  }
  if (start !== null) out.push([start, last]);
  const arcs = out.filter(([a, b]) => b - a >= MIN_ARC - 1e-9);
  if (half === CANNON_HALF_ARC) byPart.set(part.id, arcs);
  return arcs;
}

/** Is a relative angle inside one of the arcs (with half a sampling step of slack)? */
export const inArcs = (arcs: readonly Arc[], angle: number): boolean =>
  arcs.some(([a, b]) => angle >= a - ARC_STEP / 2 && angle <= b + ARC_STEP / 2);

/** Total width of the arcs (rad). */
export const arcsWidth = (arcs: readonly Arc[]): number => arcs.reduce((s, [a, b]) => s + (b - a), 0);
