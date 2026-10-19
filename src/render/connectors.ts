import type { Vec2 } from '../sim/math/vec2';
import { partCells } from '../sim/ship/grid';
import { cellPolygon, sideSolid } from '../sim/ship/shape';
import type { PlacedPart, ShipGrid } from '../sim/ship/types';

export interface ConnectorPlacement {
  kind: 'edge' | 'corner';
  /** Connector centre in the ship's local grid (a cell centre is an integer). */
  x: number;
  y: number;
  /** 0 = not turned, 1 = 90° (vertical seam). */
  rot: 0 | 1;
}

/** Shortest overlap of two neighbours' solid sides that still gets an edge connector (plan SL2 E2 §2.6). */
const MIN_EDGE_OVERLAP = 0.5;
const EPS = 1e-9;

/** Length of the overlap of the solid sides of cell `a` (side `side`) and its neighbour `b` across it. */
function solidOverlap(pa: PlacedPart, a: Vec2, pb: PlacedPart, b: Vec2, side: 0 | 1): number {
  const sa = sideSolid(pa, a, side);
  const sb = sideSolid(pb, b, (side + 2) as 2 | 3);
  if (!sa || !sb) return 0;
  return Math.max(0, Math.min(sa[1], sb[1]) - Math.max(sa[0], sb[0]));
}

/** The part's polygon in `cell` covers the grid point `at` (a cell corner); a full cell always does. */
function coversCorner(p: PlacedPart, cell: Vec2, at: Vec2): boolean {
  const poly = cellPolygon(p, cell);
  if (poly === null) return true;
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    const u = poly[i]!;
    const v = poly[(i + 1) % poly.length]!;
    // CCW polygon: the point must not lie to the right of any edge
    if ((v.x - u.x) * (at.y - u.y) - (v.y - u.y) * (at.x - u.x) < -EPS) return false;
  }
  return true;
}

/**
 * Hull connectors between occupied cells (the rules of connector_placements() in
 * art/blender/preview.py). Occupancy decides, not the part type; seams inside one multi-cell part
 * are skipped. Shaped armour (SL2 E2, plan §2.6): an edge connector only where the solid sides of
 * both neighbours overlap by at least ½, a corner connector only where all four cell polygons share
 * the corner. Ships without shapes get exactly the old placements.
 */
export function connectorPlacements(grid: ShipGrid): ConnectorPlacement[] {
  const owner = new Map<string, PlacedPart>();
  const cells: { x: number; y: number }[] = [];
  let shapes = false;
  for (const p of grid.parts) {
    if (p.shape !== undefined) shapes = true;
    for (const c of partCells(p)) {
      owner.set(`${c.x},${c.y}`, p);
      cells.push(c);
    }
  }
  cells.sort((a, b) => a.x - b.x || a.y - b.y);
  const at = (x: number, y: number) => owner.get(`${x},${y}`);

  const result: ConnectorPlacement[] = [];
  for (const { x, y } of cells) {
    const self = at(x, y)!;
    const right = at(x + 1, y);
    const up = at(x, y + 1);
    const diagonal = at(x + 1, y + 1);
    const cell = { x, y };
    if (right !== undefined && right !== self) {
      if (!shapes || solidOverlap(self, cell, right, { x: x + 1, y }, 0) >= MIN_EDGE_OVERLAP - EPS) {
        result.push({ kind: 'edge', x: x + 0.5, y, rot: 0 });
      }
    }
    if (up !== undefined && up !== self) {
      if (!shapes || solidOverlap(self, cell, up, { x, y: y + 1 }, 1) >= MIN_EDGE_OVERLAP - EPS) {
        result.push({ kind: 'edge', x, y: y + 0.5, rot: 1 });
      }
    }
    if (right !== undefined && up !== undefined && diagonal !== undefined) {
      const onePart = right === self && up === self && diagonal === self;
      const corner = { x: x + 0.5, y: y + 0.5 };
      const shared =
        !shapes ||
        (coversCorner(self, cell, corner) &&
          coversCorner(right, { x: x + 1, y }, corner) &&
          coversCorner(up, { x, y: y + 1 }, corner) &&
          coversCorner(diagonal, { x: x + 1, y: y + 1 }, corner));
      if (!onePart && shared) result.push({ kind: 'corner', x: corner.x, y: corner.y, rot: 0 });
    }
  }
  return result;
}
