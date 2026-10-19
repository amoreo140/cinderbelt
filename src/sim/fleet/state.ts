// Fleet state helpers (M4a, plan §2): the starting fleet and the hangar slot rules that
// the simulation (fleet actions), the view models and the save validation share.
import { HANGAR } from '../../data/economy';
import type { PaintId } from '../../data/paints';
import { RESOURCE_IDS } from '../../data/resources';
import { hasFeature } from '../discovery/archive';
import type { GameStats, SimState } from '../Simulation';
import type { StationId } from '../world/stations';
import { generatedNameIndex } from './names';
import type { FleetState, ShipLog, ShipRecord, StoredShip } from './types';

export const emptyShipLog = (): ShipLog => ({ distance: 0, kills: 0, mined: 0, deaths: 0, built: 0 });

/** The log of a ship that has flown the whole game so far (save migration 15 → 16). */
export const shipLogFromStats = (stats: GameStats): ShipLog => ({
  distance: stats.distanceFlown,
  kills: stats.kills,
  mined: RESOURCE_IDS.reduce((sum, r) => sum + stats.mined[r], 0),
  deaths: stats.deaths,
  built: 0,
});

/**
 * The paint of a ship (M4c). A missing field is the factory paint – new ships and records from before
 * M4c have none, and painting a ship back to `factory` removes it (one canonical form).
 */
export const paintOf = (record: ShipRecord): PaintId => record.paint ?? 'factory';

/**
 * The fleet of a new game: the starting ship is record 1 with its generated name, nothing stored,
 * no slots. Deterministic in `seed`.
 */
export function createFleet(seed: number, log: ShipLog = emptyShipLog()): FleetState {
  return {
    nextShipId: 2,
    active: { id: 1, name: null, nameIdx: generatedNameIndex(seed, 1), log: { ...log } },
    stored: [],
    slots: new Map(),
  };
}

/** Slots bought in the whole game. */
export const slotsBought = (fleet: FleetState): number => {
  let n = 0;
  for (const count of fleet.slots.values()) n += count;
  return n;
};

/** Slots bought at a station. */
export const slotsAt = (fleet: FleetState, stationId: StationId): number => fleet.slots.get(stationId) ?? 0;

/** Ships stored at a station (sorted by id). */
export const storedAt = (fleet: FleetState, stationId: StationId): StoredShip[] => fleet.stored.filter((s) => s.stationId === stationId);

/** Free slots at a station (bought minus occupied). */
export const freeSlotsAt = (fleet: FleetState, stationId: StationId): number => slotsAt(fleet, stationId) - storedAt(fleet, stationId).length;

/** Most slots the player may own in total (2, or 4 with the Archive node "Hangar +2"). */
export const hangarSlotCap = (state: SimState): number => (hasFeature(state, 'hangarPlus') ? HANGAR.maxSlots.plus : HANGAR.maxSlots.base);

/** Price of the next slot, or null when the cap is reached. */
export function nextSlotPrice(state: SimState): number | null {
  const bought = slotsBought(state.fleet);
  if (bought >= hangarSlotCap(state)) return null;
  return HANGAR.slotPrices[Math.min(bought, HANGAR.slotPrices.length - 1)];
}
