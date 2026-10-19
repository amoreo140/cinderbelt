// Texts of the far landmarks (readability pass): their names on the map (M).
// `LandmarksTexts` is the shape, enLandmarks.ts implements the same keys in English.
import type { LandmarkKind } from '../sim/world/landmarks';

export interface LandmarksTexts {
  /** Name of a landmark by kind (map label). */
  names: Record<LandmarkKind, string>;
}

export const skLandmarks: LandmarksTexts = {
  names: {
    gas_giant: 'Plynný obor',
    guild_relay: 'Starý stožiar Cechu',
    rust_ring_shard: 'Zlomený prstenec',
    crystal_spire: 'Kryštálová stena',
    dead_forge: 'Vyhasnutá výheň',
  },
};
