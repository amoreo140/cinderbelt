// Hub overview (M3.8): the docked ship lost parts against its blueprint – what is missing, the
// silhouette with the gaps, and whether this station can restore it.
import { partKey, type PartInventory } from '../data/parts';
import { missingParts } from '../sim/ship/blueprint';
import { blockedExhausts } from '../sim/ship/exhaust';
import { damagedParts } from '../sim/ship/hp';
import type { SimState } from '../sim/Simulation';
import type { StationDef } from '../sim/world/stations';
import { flightSilhouette, type Silhouette } from './combatView';

export interface DesignGap {
  silhouette: Silhouette;
  missing: PartInventory;
  missingCount: number;
  damaged: number;
  /** The station has a shipyard (restore here). */
  shipyard: boolean;
}

/** Null when the ship has every part of its blueprint. */
export function designGap(state: Pick<SimState, 'player'>, station: Pick<StationDef, 'services'>): DesignGap | null {
  const { player } = state;
  const lost = missingParts(player.blueprint, player.grid);
  if (lost.length === 0) return null;
  const missing: PartInventory = {};
  for (const p of lost) {
    const key = partKey(p.partId, p.tier, p.variant);
    missing[key] = (missing[key] ?? 0) + 1;
  }
  return {
    silhouette: flightSilhouette(state),
    missing,
    missingCount: lost.length,
    damaged: damagedParts(player.grid, player.hp).length,
    shipyard: station.services.shipyard,
  };
}

/**
 * Engines of the docked ship blowing into another part (I15 – those parts burn while the engines fire;
 * a ship from an old save may have them). 0 = none; the hub shows a card with the way to the shipyard.
 */
export function coveredNozzles(state: Pick<SimState, 'player'>): number {
  return new Set(blockedExhausts(state.player.grid).map((b) => b.engineId)).size;
}
