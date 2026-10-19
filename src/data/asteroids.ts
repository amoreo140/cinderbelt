// Asteroid model data for the simulation: veins (a copy of veins.json from the artist) and the bounding
// spheres of the models (render and simulation both scale a model to unit radius by them).
import type { ResourceId } from './resources';
import modelsJson from './asteroid_models.json';
import veinsJson from './asteroid_veins.json';

/** Shape variants: a = round, b = elongated, c = angular (art/README 2.7). */
export const ASTEROID_MODEL_VARIANTS = ['a', 'b', 'c'] as const;

export type Vec3Tuple = [number, number, number];

export interface AsteroidModelBounds {
  /** Centre of the bounding sphere in model coordinates (glTF, Y up). */
  center: Vec3Tuple;
  radius: number;
}

/** Vein kind (veins.json `type`): drift = Fe/Cu, deep = Ti, singing = Kr, fast = VZ. */
export type VeinType = 'drift' | 'deep' | 'singing' | 'fast';

export interface VeinData {
  /** Name of the fill mesh node (`Vein_<i>`). */
  node: string;
  /** Length of the centre line in model units. */
  length: number;
  /** Centre line of the fill in model coordinates, sorted by u. */
  points: Vec3Tuple[];
  /** u of every point (= TEXCOORD_1.u), 0 … 1 linear by length. */
  u: number[];
  normals: Vec3Tuple[];
  halfWidth: number[];
  type: VeinType;
}

/** Bounding spheres of the models by file name without the extension. */
export const ASTEROID_MODEL_BOUNDS = modelsJson as unknown as Readonly<Record<string, AsteroidModelBounds>>;

const { _schema: _ignored, ...veinEntries } = veinsJson as unknown as Record<string, { veins: VeinData[] }>;

/** Veins of the models by file name (models without veins – ice – are not here). */
export const ASTEROID_VEINS: Readonly<Record<string, readonly VeinData[]>> = Object.fromEntries(
  Object.entries(veinEntries).map(([name, entry]) => [name, entry.veins]),
);

/** Asteroid model name, e.g. `asteroid_iron_b`. */
export const asteroidModelName = (resource: ResourceId, variantIndex: number): string =>
  `asteroid_${resource}_${ASTEROID_MODEL_VARIANTS[variantIndex] ?? 'a'}`;
