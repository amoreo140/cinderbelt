// Ship grid <-> save (SavedGridV1), shared by the player, respawn, combat and fleet serialisation, and
// the grid helpers of the save validation.
import { partCells } from '../ship/grid';
import type { ShipGrid } from '../ship/types';
import { HANGAR_MAX, HANGAR_MIN } from '../shipyard/editor';
import type { SavedGridV1 } from './types';

export const gridToSave = (grid: ShipGrid): SavedGridV1 => ({
  nextId: grid.nextId,
  parts: grid.parts.map((p) => ({
    id: p.id,
    partId: p.partId,
    tier: p.tier,
    x: p.x,
    y: p.y,
    rot: p.rot,
    ...(p.variant ? { variant: p.variant } : {}),
    ...(p.loan ? { loan: true as const } : {}),
    // V18 (SL2 E2): only a shaped part carries its shape, so an unshaped grid saves as before
    ...(p.shape !== undefined ? { shape: p.shape } : {}),
  })),
});

export const gridFromSave = (grid: SavedGridV1): ShipGrid => ({
  nextId: grid.nextId,
  parts: grid.parts.map((p) => ({ ...p })),
});

/** A saved grid as a ship grid for the grid checks (a copy; shapes kept, so footprints follow them). */
export const gridShape = (g: SavedGridV1): ShipGrid => ({ nextId: g.nextId, parts: g.parts.map((p) => ({ ...p })) });

/**
 * A grid within the hangar −7…7 (shape footprints included – a wing is 2×1): unchanged, moved into the
 * middle of the hangar (the whole shape fits – a body's position is its centre of mass, so a flying ship
 * stays where it is), or null when it is larger than the hangar.
 */
export function fitHangar(grid: SavedGridV1): SavedGridV1 | null {
  const cells = gridShape(grid).parts.flatMap((p) => partCells(p));
  if (cells.length === 0) return grid;
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const size = HANGAR_MAX - HANGAR_MIN;
  if (box.maxX - box.minX > size || box.maxY - box.minY > size) return null;
  if (box.minX >= HANGAR_MIN && box.maxX <= HANGAR_MAX && box.minY >= HANGAR_MIN && box.maxY <= HANGAR_MAX) return grid;
  const dx = -Math.floor((box.minX + box.maxX) / 2);
  const dy = -Math.floor((box.minY + box.maxY) / 2);
  return { nextId: grid.nextId, parts: grid.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
}
