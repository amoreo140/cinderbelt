// Sector state (long-term design 8.4): rotating modifiers of the sectors over game time.
// A warning makes the game harder and raises contract rewards, an anomaly changes the play, a market changes prices.
// Modifiers that need a system of a later milestone have `since` and are not drawn; derived ones are never drawn.
import type { RingIndex } from './economy';

export type SectorModifierId =
  | 'ionSeason'
  | 'huntingGrounds'
  | 'radiationWave'
  | 'currents'
  | 'richVein'
  | 'demand'
  | 'convoy'
  | 'eclipse'
  | 'silentZone'
  | 'cometFlyby'
  | 'crystalSong'
  | 'pirateWar'
  | 'fuelShortage'
  | 'solarWind';

export type SectorModifierKind = 'warning' | 'anomaly' | 'market' | 'event';

/** Effects of a modifier (a missing field = no effect). */
export interface SectorEffects {
  /** Multiplier of the chance of a pirate group in a chunk. */
  pirateMult: number;
  /** Multiplier of the bonus on the active vein segment. */
  veinYieldMult: number;
  /** Multiplier of the ship's energy generation. */
  energyGenMult: number;
  /** Multiplier of the engines' fuel use. */
  fuelUseMult: number;
  /** Multiplier of the fuel price at the sector's stations. */
  fuelPriceMult: number;
  /** Multiplier of the radar range. */
  radarMult: number;
  /** Acceleration of the gravity current (u/s²). */
  drift: number;
  /** Multiplier of the ion storm chance (M3.5b, data/events.ts). */
  ionStormMult: number;
  /** Multiplier of pirate attention gains (M3.6, design 8.4 hunting grounds ×1.5). */
  attentionMult: number;
}

export const NEUTRAL_EFFECTS: SectorEffects = {
  pirateMult: 1,
  veinYieldMult: 1,
  energyGenMult: 1,
  fuelUseMult: 1,
  fuelPriceMult: 1,
  radarMult: 1,
  drift: 0,
  ionStormMult: 1,
  attentionMult: 1,
};

export interface SectorModifierDef {
  id: SectorModifierId;
  kind: SectorModifierKind;
  /** Bonus on the rewards of contracts from the sector (0.25 = +25 %). */
  bonus: number;
  /** Depths (formerly rings) where it may appear. */
  rings: readonly RingIndex[];
  effects: Partial<SectorEffects>;
  /** Weight in the roll. */
  weight: number;
  /** Milestone of the system the modifier needs (missing = works now). */
  since?: string;
  /**
   * Derived, not rolled (M4b): the sector state adds it from another system (`cometFlyby` from the comet
   * passes, `convoy` from the convoy schedule – M4d; src/sim/sector/sector.ts) as an extra modifier that
   * does not count to MAX_SECTOR_MODIFIERS.
   * Never drawn by the modifier roll, so the rolled local conditions never change.
   */
  derived?: boolean;
}

const ALL_RINGS: readonly RingIndex[] = [1, 2, 3, 4];

export const SECTOR_MODIFIERS: Record<SectorModifierId, SectorModifierDef> = {
  // more frequent ion storms (5.5, M3.5b): shields off, radar ×0.5
  ionSeason: { id: 'ionSeason', kind: 'warning', bonus: 0.25, rings: [2, 3, 4], effects: { ionStormMult: 3 }, weight: 3 },
  huntingGrounds: { id: 'huntingGrounds', kind: 'warning', bonus: 0.3, rings: [2, 3, 4], effects: { pirateMult: 1.5, attentionMult: 1.5 }, weight: 3 },
  radiationWave: { id: 'radiationWave', kind: 'warning', bonus: 0.35, rings: [3], effects: {}, weight: 2, since: 'M5a' },
  // no (gravity) slings yet – the current carries the ship and the dampers burn fuel
  currents: { id: 'currents', kind: 'anomaly', bonus: 0, rings: ALL_RINGS, effects: { drift: 0.6 }, weight: 2 },
  richVein: { id: 'richVein', kind: 'anomaly', bonus: 0, rings: ALL_RINGS, effects: { veinYieldMult: 2 }, weight: 3 },
  demand: { id: 'demand', kind: 'market', bonus: 0, rings: ALL_RINGS, effects: {}, weight: 3 },
  // a Free Traders convoy pass crosses the sector in this epoch (M4d, derived from the convoy schedule,
  // src/sim/convoys/schedule.ts – never rolled)
  convoy: { id: 'convoy', kind: 'event', bonus: 0, rings: ALL_RINGS, effects: {}, weight: 2, derived: true },
  // signal darkness in depth 4: radar ×0.4 (the deep scanner comes in M6a)
  eclipse: { id: 'eclipse', kind: 'warning', bonus: 0.4, rings: [4], effects: { radarMult: 0.4 }, weight: 2 },
  silentZone: { id: 'silentZone', kind: 'anomaly', bonus: 0, rings: [3, 4], effects: {}, weight: 2, since: 'M5a' },
  // a comet pass crosses the sector in this epoch (M4b, derived from the comet passes – never rolled)
  cometFlyby: { id: 'cometFlyby', kind: 'event', bonus: 0, rings: ALL_RINGS, effects: {}, weight: 1, derived: true },
  crystalSong: { id: 'crystalSong', kind: 'anomaly', bonus: 0, rings: [3], effects: {}, weight: 2, since: 'M5a' },
  // the clans fight each other – half of them on patrol (wrecks everywhere come with the M4b graveyards)
  pirateWar: { id: 'pirateWar', kind: 'warning', bonus: 0, rings: [2, 3, 4], effects: { pirateMult: 0.5 }, weight: 2 },
  fuelShortage: { id: 'fuelShortage', kind: 'market', bonus: 0, rings: ALL_RINGS, effects: { fuelPriceMult: 1.5 }, weight: 2 },
  solarWind: { id: 'solarWind', kind: 'anomaly', bonus: 0, rings: ALL_RINGS, effects: { fuelUseMult: 0.7 }, weight: 2 },
};

export const SECTOR_MODIFIER_IDS = Object.keys(SECTOR_MODIFIERS) as SectorModifierId[];
/** Modifiers the roll may draw: working now (no `since`) and not derived. */
export const ACTIVE_SECTOR_MODIFIERS: readonly SectorModifierId[] = SECTOR_MODIFIER_IDS.filter((id) => !SECTOR_MODIFIERS[id].since && !SECTOR_MODIFIERS[id].derived);

/** Area = a block of 5 × 5 chunks (8.4). */
export const SECTOR_AREA_CHUNKS = 5;
/** The state changes every 30 game minutes; the first half hour is calm ("First day"). */
export const SECTOR_EPOCH_TICKS = 30 * 60 * 60;
/** At most 2 rolled modifiers at once, at most 1 warning and 1 market of them (a derived one comes on top). */
export const MAX_SECTOR_MODIFIERS = 2;
/** Probability of 0 / 1 / 2 modifiers. */
export const SECTOR_COUNT_WEIGHTS: readonly [number, number, number] = [0.3, 0.45, 0.25];
/** Demand for X: buy price +45 %, cap 150 u per station and epoch. */
export const DEMAND_BONUS = 0.45;
export const DEMAND_CAP = 150;
