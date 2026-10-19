// M4c "Home and Workshop" <-> save (V19): the home station (built modules in HOME_MODULE_IDS order, pins in pin order), and
// the workshop state of a ship – refined ore as a canonical partial cargo (positive amounts only, resource
// order, never above the cargo) and the repair module's material bank (dropped when its part is gone).
// Paints live on the fleet records (fleet.ts).
import { HOME_MODULE_IDS } from '../../data/home';
import { emptyCargo, RESOURCE_IDS, type Cargo } from '../../data/resources';
import { createHome } from '../home/state';
import type { HomeState } from '../home/types';
import { clampRefined, type RepairBank } from '../ship/workshop';
import type { ShipGrid } from '../ship/types';
import type { SavedGridV1, SavedHomeV19, SavedRefinedV19, SavedRepairBankV19 } from './types';

export function homeToSave(h: HomeState): SavedHomeV19 {
  return { modules: HOME_MODULE_IDS.filter((id) => h.modules.has(id)), trophyPins: [...h.trophyPins] };
}

export function homeFromSave(s: SavedHomeV19): HomeState {
  return { modules: new Set(s.modules), trophyPins: [...s.trophyPins] };
}

/** The home of a save before V19 (the 18 → 19 migration): nothing built, nothing pinned. */
export const legacyHome = (): SavedHomeV19 => homeToSave(createHome());

/**
 * Refined ore for the save: clamped to the cargo on a copy (a death applied between two steps may have
 * taken cargo without the step's clamp – the "death gap"), positive amounts only.
 */
export function refinedToSave(cargo: Cargo, refined: Cargo): SavedRefinedV19 {
  const fine = { ...refined };
  clampRefined(cargo, fine);
  const out: SavedRefinedV19 = {};
  for (const r of RESOURCE_IDS) if (fine[r] > 0) out[r] = fine[r];
  return out;
}

/** A full refined cargo from the save, clamped to `cargo` (the validation already checked it). */
export function refinedFromSave(cargo: Cargo, s: SavedRefinedV19): Cargo {
  const out = emptyCargo();
  for (const r of RESOURCE_IDS) out[r] = s[r] ?? 0;
  clampRefined(cargo, out);
  return out;
}

export const hasRefined = (s: SavedRefinedV19): boolean => RESOURCE_IDS.some((r) => (s[r] ?? 0) > 0);

/** The repair bank if its part is still in the grid (a bank of a destroyed or removed part is worth nothing). */
export function repairToSave(bank: RepairBank | null, grid: ShipGrid | SavedGridV1): SavedRepairBankV19 | null {
  if (!bank || !grid.parts.some((p) => p.id === bank.part)) return null;
  return { part: bank.part, bank: bank.bank };
}
