// Fleet state (M4a "Hangar and Fleet"): the active ship's record and the
// ships stored in hangar slots at shipyard stations. The active ship itself stays `state.player`;
// `FleetState.active` is only its identity (name) and log.
import type { PaintId } from '../../data/paints';
import type { Cargo } from '../../data/resources';
import type { HpMap, ShipGrid } from '../ship/types';
import type { StationId } from '../world/stations';

/** Stable id of a ship in this game (1 = the starting ship; ids are never reused). */
export type ShipId = number;

/**
 * The ship's log: its own share of the global `GameStats`, updated as deltas in
 * `Simulation.trackProgress` (deaths in `applyDeath`). Only the active ship's log grows.
 */
export interface ShipLog {
  /** Distance flown, world units. */
  distance: number;
  /** Pirates destroyed. */
  kills: number;
  /** Units mined, all resources together. */
  mined: number;
  /** Times the ship was destroyed (or scuttled) with this record active. */
  deaths: number;
  /** Tick the ship was built (0 = the starting ship / migrated saves). */
  built: number;
}

/** Identity of one ship: id, name, log. Survives death and respawn of the active ship. */
export interface ShipRecord {
  id: ShipId;
  /** Custom name (sanitised, never translated), or null = the generated name `nameIdx`. */
  name: string | null;
  /** Index into `tx().fleet.names` (0 ≤ nameIdx < SHIP_NAME_COUNT) – used while `name` is null. */
  nameIdx: number;
  log: ShipLog;
  /** Paint of the ship (M4c paint shop); missing = 'factory'. Follows the record through switch, store and death. */
  paint?: PaintId;
}

/**
 * A ship parked in a hangar slot. It is "cold": no shield, energy, heat, cooldowns or tractor are
 * kept (on activation shield and energy are full, heat and cooldowns empty).
 */
export interface StoredShip {
  record: ShipRecord;
  /** Station it stands at (always a station with a shipyard). */
  stationId: StationId;
  /** Never contains Guild loan parts (`loan: true`). */
  grid: ShipGrid;
  blueprint: ShipGrid;
  /** HP of damaged parts by part id (missing entry = full HP), like `player.hp`. */
  hp: HpMap;
  fuel: number;
  cargo: Cargo;
  /** Refined part of `cargo` (M4c refinery, ≤ cargo per resource, no ice); missing = nothing refined. */
  refined?: Cargo;
}

export interface FleetState {
  /** Id of the next ship built (starts at 2). */
  nextShipId: ShipId;
  /** Record of the active ship (`state.player`). */
  active: ShipRecord;
  /** Stored ships, sorted by `record.id`. */
  stored: StoredShip[];
  /** Bought slots per station (only stations with a shipyard; entries > 0). */
  slots: Map<StationId, number>;
}
