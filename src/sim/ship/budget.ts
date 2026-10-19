// Hull budget by cockpit (long-term design 3.4.1): points by part size, the cap by cockpit tier. Replaces
// the original 100-part limit of spec M2. Shaped armour (SL2 E2, spec 2026-10-19 §2.7) scores its table
// points in ½ steps, so `hullPoints` may be a half number (format it with `formatHullPoints`).
//
// This module must not import ./shape (shape imports `sizeHullPoints` from here): the shape points are read
// straight from the catalogue – the same rule as shape's `shapeHullPoints` (tested to agree).
import { partDef, type Tier } from '../../data/parts';
import { SHAPES, isShapeId } from '../../data/shapes';
import type { PlacedPart, ShipGrid } from './types';

/** Hull points by footprint: 1×1 = 1, 2×1 = 2, 3×1 = 3, 2×2 = 3 (big parts are slightly cheaper). */
export function sizeHullPoints(size: { w: number; h: number }): number {
  const cells = size.w * size.h;
  return size.w >= 2 && size.h >= 2 ? cells - 1 : cells;
}

/** The part's hull points: a shape's table points (½, 1 or 1½), else by the part's size. */
export const partHullPoints = (p: PlacedPart): number =>
  p.shape !== undefined && isShapeId(p.shape) ? SHAPES[p.shape].points : sizeHullPoints(partDef(p.partId, p.tier, p.variant).size);

export const hullPoints = (grid: ShipGrid): number => grid.parts.reduce((s, p) => s + partHullPoints(p), 0);

export interface HullBudget {
  /** Points used; a multiple of ½. */
  used: number;
  /** The cockpit's budget; null = the ship does not have exactly one cockpit. */
  budget: number | null;
  cockpitTier: Tier | null;
  over: boolean;
}

export function hullBudgetOf(grid: ShipGrid): HullBudget {
  const used = hullPoints(grid);
  const cockpits = grid.parts.filter((p) => p.partId === 'cockpit');
  if (cockpits.length !== 1) return { used, budget: null, cockpitTier: null, over: false };
  const cockpit = cockpits[0]!;
  const budget = partDef('cockpit', cockpit.tier, cockpit.variant).hullBudget ?? 0;
  return { used, budget, cockpitTier: cockpit.tier, over: used > budget };
}
