// HP of installed parts (spec M2, 5.3). A missing entry in the HpMap = full HP.
//
// Shaped armour (SL2 E2): its max HP is the full part's
// HP × the shape's area, rounded to an integer. Damage is the HP missing, measured in full-part HP
// (`fullEquivalentHp`) – a shaped plate is one inventory item folded, its other part intact.
import { partDef } from '../../data/parts';
import { hpMultOf } from './shape';
import type { HpMap, PlacedPart, ShipGrid } from './types';

/** HP of the part laid full (the part definition), shape or not. */
export const fullMaxHp = (p: PlacedPart): number => partDef(p.partId, p.tier, p.variant).hp;

/** Max HP of the installed part: `round(def.hp × hpMult)`; without a shape exactly `def.hp`. */
export const maxHp = (p: PlacedPart): number => (p.shape === undefined ? fullMaxHp(p) : Math.round(fullMaxHp(p) * hpMultOf(p)));

/** The part's HP as if it were laid full: full max HP minus the HP it is missing. */
export const fullEquivalentHp = (p: PlacedPart, hp: number): number => fullMaxHp(p) - (maxHp(p) - hp);

export const currentHp = (hp: HpMap, p: PlacedPart): number => Math.min(hp.get(p.id) ?? maxHp(p), maxHp(p));

/** Parts below their max HP (in grid order). */
export function damagedParts(grid: ShipGrid, hp: HpMap): PlacedPart[] {
  return grid.parts.filter((p) => currentHp(hp, p) < maxHp(p));
}

/** Current HP of the whole ship (`hullHp(…).current` without the object – the AI asks every step). */
export function hullCurrent(grid: ShipGrid, hp: HpMap): number {
  let current = 0;
  const parts = grid.parts;
  for (let i = 0; i < parts.length; i++) current += currentHp(hp, parts[i]!);
  return current;
}

/** Current and max HP of the whole ship. */
export function hullHp(grid: ShipGrid, hp: HpMap): { current: number; max: number } {
  let current = 0;
  let max = 0;
  for (const p of grid.parts) {
    current += currentHp(hp, p);
    max += maxHp(p);
  }
  return { current, max };
}
