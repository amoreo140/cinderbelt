// Ship blueprint (M3.8): the layout of the last confirmed shipyard design. Parts destroyed or torn
// off in flight simply leave the grid – the blueprint is what lets the game say what is missing.
import { damagedParts } from './hp';
import { isLoanPart } from './loan';
import type { HpMap, PlacedPart, ShipGrid } from './types';

/** Same part in the same place (id, type, tier, variant, cell, rotation, shape – SL2 E2). */
export const samePlacement = (a: PlacedPart, b: PlacedPart): boolean =>
  a.id === b.id &&
  a.partId === b.partId &&
  a.tier === b.tier &&
  a.variant === b.variant &&
  a.x === b.x &&
  a.y === b.y &&
  a.rot === b.rot &&
  a.shape === b.shape;

/**
 * Does the ship come from the blueprint – is every installed part in it, unmoved? In play this
 * always holds (flight only removes parts); a ship replaced some other way has no meaningful blueprint.
 * A Guild loan part mounted since (not in the blueprint) does not count (I3) – the loan stands in for a
 * lost part, it must not hide what is missing.
 */
export function blueprintMatches(blueprint: ShipGrid, grid: ShipGrid): boolean {
  const byId = new Map(blueprint.parts.map((p) => [p.id, p]));
  return grid.parts.every((p) => {
    const b = byId.get(p.id);
    if (b === undefined) return isLoanPart(p);
    return samePlacement(p, b);
  });
}

/** Blueprint parts the ship no longer has (in blueprint order); none when the ship does not come from it. */
export function missingParts(blueprint: ShipGrid, grid: ShipGrid): PlacedPart[] {
  if (!blueprintMatches(blueprint, grid)) return [];
  const present = new Set(grid.parts.map((p) => p.id));
  return blueprint.parts.filter((p) => !present.has(p.id));
}

export interface BlueprintStatus {
  /** Parts lost since the last shipyard design. */
  missing: PlacedPart[];
  /** Installed parts below full HP. */
  damaged: number;
}

export function blueprintStatus(blueprint: ShipGrid, grid: ShipGrid, hp: HpMap): BlueprintStatus {
  return { missing: missingParts(blueprint, grid), damaged: damagedParts(grid, hp).length };
}
