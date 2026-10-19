// Combat geometry: the ship frame, the cell map and the grid walk (DDA, spec 2.3), polygon hits of
// shaped cells (SL2 E2).
import { partCells } from '../ship/grid';
import { cellPolygon, segmentPolygonEntry, type Poly } from '../ship/shape';
import { add, rotate, sub, type Vec2 } from '../math/vec2';
import type { Body } from '../physics/body';
import type { ShipGrid } from '../ship/types';

/** World point → ship grid coordinates (cell centres are integers). */
export const worldToGrid = (body: Body, centerOfMass: Vec2, p: Vec2): Vec2 =>
  add(rotate(sub(p, body.pos), -body.angle), centerOfMass);

/** Ship grid coordinates → world point. */
export const gridToWorld = (body: Body, centerOfMass: Vec2, g: Vec2): Vec2 =>
  add(body.pos, rotate(sub(g, centerOfMass), body.angle));

const ownersCache = new WeakMap<ShipGrid, Map<string, number>>();

/** Cell 'x,y' → part id. Cached per grid object (grids are replaced on change). */
export function cellOwners(grid: ShipGrid): Map<string, number> {
  let map = ownersCache.get(grid);
  if (!map) {
    map = new Map();
    for (const p of grid.parts) for (const c of partCells(p)) map.set(`${c.x},${c.y}`, p.id);
    ownersCache.set(grid, map);
  }
  return map;
}

/** A cell that is only partly solid: its part and the part's outline clipped to the cell (grid frame). */
export interface CellShape {
  partId: number;
  poly: Poly;
}

const shapesCache = new WeakMap<ShipGrid, ReadonlyMap<string, CellShape>>();
const NO_SHAPES: ReadonlyMap<string, CellShape> = new Map();

/**
 * Cell 'x,y' → its polygon, for the cells of shaped parts that are not fully solid (the rear cell of a
 * 2×1 nose stays a plain cell). Cached per grid object; a grid without shapes gets the shared empty
 * map – the fast path, hits stay bit-identical to the plain DDA.
 */
export function shapedCells(grid: ShipGrid): ReadonlyMap<string, CellShape> {
  let map = shapesCache.get(grid);
  if (!map) {
    let out: Map<string, CellShape> | null = null;
    for (const p of grid.parts) {
      if (p.shape === undefined) continue;
      for (const c of partCells(p)) {
        const poly = cellPolygon(p, c);
        if (poly === null) continue;
        out ??= new Map();
        out.set(`${c.x},${c.y}`, { partId: p.id, poly });
      }
    }
    map = out ?? NO_SHAPES;
    shapesCache.set(grid, map);
  }
  return map;
}

export interface GridHit {
  partId: number;
  cell: Vec2;
  /**
   * Parameter along the segment (0 = start, 1 = end) where it enters the solid part of the cell: the
   * cell square, or the polygon of a shaped cell (the spark sits on the shape's edge).
   */
  t: number;
}

/** Most cells one walk checks (guard against endless loops). */
const MAX_STEPS = 256;

/**
 * First occupied cell along the segment from → to (grid coordinates). Cell (i, j) covers
 * [i − ½, i + ½] × [j − ½, j + ½]. Amanatides–Woo walk. With `shapes`, an owned cell listed there is
 * hit only where the segment enters its polygon; a miss walks on to the next cell (a shot flies
 * through the empty half of a wedge). Without `shapes` (or with an empty map) the plain cell walk.
 */
export function raycastGrid(owners: ReadonlyMap<string, number>, from: Vec2, to: Vec2, shapes?: ReadonlyMap<string, CellShape>): GridHit | null {
  const shaped = shapes !== undefined && shapes.size > 0 ? shapes : null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let cx = Math.floor(from.x + 0.5);
  let cy = Math.floor(from.y + 0.5);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
  let tMaxX = dx > 0 ? (cx + 0.5 - from.x) / dx : dx < 0 ? (cx - 0.5 - from.x) / dx : Infinity;
  let tMaxY = dy > 0 ? (cy + 0.5 - from.y) / dy : dy < 0 ? (cy - 0.5 - from.y) / dy : Infinity;
  let t = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    const key = `${cx},${cy}`;
    const owner = owners.get(key);
    if (owner !== undefined) {
      const cell = shaped?.get(key);
      if (!cell) return { partId: owner, cell: { x: cx, y: cy }, t };
      const entry = segmentPolygonEntry(from, to, cell.poly);
      if (entry !== null) return { partId: owner, cell: { x: cx, y: cy }, t: entry };
    }
    if (tMaxX < tMaxY) {
      t = tMaxX;
      if (t > 1) return null;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      t = tMaxY;
      if (t > 1) return null;
      cy += stepY;
      tMaxY += tDeltaY;
    }
  }
  return null;
}

/**
 * First hit of the segment (grid coordinates) on the ship's parts, polygon-aware for shaped cells.
 * `alive` limits the walk to those part ids (the others are holes). The one entry point for
 * projectiles, shield overflow, pass-through, wreck cutting and micrometeors.
 */
export function raycastShip(grid: ShipGrid, from: Vec2, to: Vec2, alive?: ReadonlySet<number>): GridHit | null {
  const all = cellOwners(grid);
  const owners = alive ? new Map([...all].filter(([, id]) => alive.has(id))) : all;
  return raycastGrid(owners, from, to, shapedCells(grid));
}

/** Parameter t ∈ [0, 1] where the segment enters the circle; null = a miss, or it starts inside. */
export function segmentCircle(from: Vec2, to: Vec2, center: Vec2, radius: number): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const mx = from.x - center.x;
  const my = from.y - center.y;
  const a = dx * dx + dy * dy;
  const c = mx * mx + my * my - radius * radius;
  if (c <= 0 || a < 1e-12) return null;
  const b = mx * dx + my * dy;
  if (b >= 0) return null;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t <= 1 ? t : null;
}
