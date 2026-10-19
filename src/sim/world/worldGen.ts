// World generation rules (saved as `worldGen` since save V14). The world is derived from the seed;
// when a rule that places or picks world content changes, the new rule gets a new generation, so
// an existing save keeps the world it was played in (stations, their models and collision circles,
// POI, asteroids never change under the player). New games take the latest generation.
//
// 1 – every save before V14 (the original rules).
// 2 – station models by the ring and role (art batch D variants, data/stations.ts stationModelForRing).
// The sectors design adds its rules as the
// next generation.

export type WorldGen = 1 | 2;

export const WORLD_GENS: readonly WorldGen[] = [1, 2];
/** The rules of every save made before the field existed. */
export const WORLD_GEN_LEGACY: WorldGen = 1;
/** The rules of a new game. */
export const WORLD_GEN_LATEST: WorldGen = 2;
