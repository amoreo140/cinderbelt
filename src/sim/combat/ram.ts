// Ram damage (M21, spec 2.3): ship–asteroid and ship–ship. The damage grows with the impact speed over
// a safe limit and goes to the cell in contact (the shield first, then the part). Stations and wrecks
// do not damage; pirates ramming asteroids do not either (the AI does not avoid them).
// Collisions are per cell by design (SL2 E2 plan §2.2, spec §2.6): the rammed cell is a whole cell even
// for a shaped part, so `partAtCell` is a plain cell lookup – no polygon test here.
import { add, type Vec2 } from '../math/vec2';
import type { ShipProperties } from '../ship/properties';
import type { ShipGrid } from '../ship/types';
import { cellOwners } from './geometry';

/** Up to this impact speed (= the highest docking speed) a ram does no damage. */
export const RAM_SAFE_SPEED = 8;
/** HP per unit of speed over the safe limit. */
export const RAM_DAMAGE_PER_SPEED = 1;

export const ramDamage = (impactSpeed: number): number =>
  impactSpeed > RAM_SAFE_SPEED ? (impactSpeed - RAM_SAFE_SPEED) * RAM_DAMAGE_PER_SPEED : 0;

/**
 * In a ship–ship collision the impulse splits the speed by mass: the lighter ship gets more
 * (a multiplier of 1 for equal masses).
 */
export const ramShare = (mass: number, otherMass: number): number => (2 * otherMass) / (mass + otherMass);

/** The part in cell `cell` (an element of the ship's cellOffsets – relative to the centre of mass), or null; per cell (shapes ignored). */
export function partAtCell(grid: ShipGrid, props: Pick<ShipProperties, 'centerOfMass'>, cell: Vec2): number | null {
  const g = add(cell, props.centerOfMass);
  return cellOwners(grid).get(`${Math.round(g.x)},${Math.round(g.y)}`) ?? null;
}
