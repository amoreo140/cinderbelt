// Journal – Atlas (long-term design 5.6): collections of discovered things with a percentage and a completion reward.
// Collections hold only what exists in this version of the game (planets, workshops and further types come later).
import { CAPTAIN_COUNT } from './captains';
import { ECHO_INDICES } from './echoes';
import { ANOMALY_TYPES, WRECK_CLASSES } from './poi';
import { RESOURCE_IDS } from './resources';
import { VARIANT_IDS } from './variants';

export type AtlasCollection = 'asteroids' | 'anomalies' | 'wrecks' | 'giants' | 'echoes' | 'variants' | 'captains';
export const ATLAS_COLLECTIONS: readonly AtlasCollection[] = ['asteroids', 'anomalies', 'wrecks', 'giants', 'echoes', 'variants', 'captains'];

/** Collection items (keys) – order = order in the Atlas. */
export const ATLAS_ITEMS: Record<AtlasCollection, readonly string[]> = {
  asteroids: RESOURCE_IDS,
  anomalies: ANOMALY_TYPES,
  wrecks: WRECK_CLASSES,
  giants: RESOURCE_IDS,
  echoes: ECHO_INDICES.map(String),
  variants: VARIANT_IDS,
  captains: Array.from({ length: CAPTAIN_COUNT }, (_, i) => String(i)),
};

/** Data for a completed collection (0 = the reward is the story or the part itself). */
export const ATLAS_REWARD: Record<AtlasCollection, number> = {
  asteroids: 30,
  anomalies: 60,
  wrecks: 40,
  giants: 40,
  echoes: 0,
  variants: 0,
  captains: 0,
};
