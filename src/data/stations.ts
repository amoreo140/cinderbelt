// Station layouts (radii, dock port, collision circles) are a copy of the artist's
// art/blender/data/station_layouts.json – the models must fit into it.
// When the artist changes it, copy the file again (the test in stations.test.ts catches a difference).
import layouts from './station_layouts.json';

export type StationKind = 'home' | 'station' | 'outpost';

/** Station model = the file `public/assets/models/stations/<model>.glb`. */
export type StationModel =
  | 'station_home'
  | 'station_a'
  | 'station_b'
  | 'station_c'
  | 'station_d'
  | 'station_e'
  | 'outpost_a'
  | 'outpost_b'
  | 'outpost_c'
  | 'outpost_d';

export interface StationServices {
  /** Resource market. */
  market: boolean;
  /** Buying and selling parts (M2b). */
  partsMarket: boolean;
  crafting: boolean;
  shipyard: boolean;
  repair: boolean;
  refuel: boolean;
  save: boolean;
}

const ALL_SERVICES: StationServices = {
  market: true, partsMarket: true, crafting: true, shipyard: true, repair: true, refuel: true, save: true,
};

export const STATION_SERVICES: Record<StationKind, StationServices> = {
  home: ALL_SERVICES,
  station: ALL_SERVICES,
  // outpost: only the resource market, service and saving
  outpost: { ...ALL_SERVICES, partsMarket: false, crafting: false, shipyard: false },
};

/** Collision circle in the station's local frame (+x = dock direction). */
export interface LayoutCircle {
  x: number;
  y: number;
  r: number;
}

export interface StationLayout {
  /** Station radius R; the dock port lies at (R, 0). */
  radius: number;
  dockPort: { x: number; y: number };
  /** No asteroids around the station at least this far. */
  clearRadius: number;
  circles: LayoutCircle[];
}

export const STATION_LAYOUTS: Record<StationModel, StationLayout> = {
  station_home: layouts.station_home,
  station_a: layouts.station_a,
  station_b: layouts.station_b,
  station_c: layouts.station_c,
  station_d: layouts.station_d,
  station_e: layouts.station_e,
  outpost_a: layouts.outpost_a,
  outpost_b: layouts.outpost_b,
  outpost_c: layouts.outpost_c,
  outpost_d: layouts.outpost_d,
};

/** Radius by the station kind (spec 5.4). */
export const STATION_KIND_RADIUS: Record<StationKind, number> = { home: 14, station: 10, outpost: 6 };

/** Every model of each kind (art batch D added station_d/e and outpost_c/d). */
export const STATION_MODELS: Record<StationKind, readonly StationModel[]> = {
  home: ['station_home'],
  station: ['station_a', 'station_b', 'station_c', 'station_d', 'station_e'],
  outpost: ['outpost_a', 'outpost_b', 'outpost_c', 'outpost_d'],
};

/**
 * The model lists of the first world generation – FROZEN: `stationModelFor` picks from them by the
 * variant, and every save of that generation must keep its stations' models (and collision circles).
 */
const LEGACY_STATION_MODELS: Record<StationKind, readonly StationModel[]> = {
  home: ['station_home'],
  station: ['station_a', 'station_b', 'station_c'],
  outpost: ['outpost_a', 'outpost_b'],
};

const pickBy = (models: readonly StationModel[], t: number): StationModel =>
  models[Math.min(models.length - 1, Math.max(0, Math.floor(t * models.length)))]!;

/** World generation 1 (every save before V14): the model by the variant alone. Never change it. */
export function stationModelFor(kind: StationKind, variant: number): StationModel {
  return pickBy(LEGACY_STATION_MODELS[kind], variant);
}

/**
 * World generation 2 (new games from save V14): the model by the ring and the role.
 * A station keeps the role of the generation-1 pick (a third each by the variant: trade, mining,
 * research – the traffic voice never depends on the generation); the rest of the variant picks
 * the building within the role:
 * - trade: ring 2 half fortified frontier posts (station_e), else station_a;
 * - mining: station_b;
 * - research: rings 1–3 two thirds Institute research stations (station_d), else station_c.
 * Outposts: ring 2 adds the armoured relay (outpost_d), ring 3 the ice-moored outpost (outpost_c),
 * a third each.
 */
export function stationModelForRing(kind: StationKind, variant: number, ring: number): StationModel {
  if (kind === 'home') return 'station_home';
  if (kind === 'outpost') {
    if (ring === 2) return pickBy(['outpost_a', 'outpost_b', 'outpost_d'], variant);
    if (ring === 3) return pickBy(['outpost_a', 'outpost_b', 'outpost_c'], variant);
    return stationModelFor(kind, variant);
  }
  const legacy = stationModelFor(kind, variant);
  const roles = LEGACY_STATION_MODELS.station.length;
  const within = Math.min(1, Math.max(0, variant * roles - Math.floor(variant * roles)));
  if (legacy === 'station_a') return ring === 2 && within < 0.5 ? 'station_e' : 'station_a';
  if (legacy === 'station_c') return ring <= 3 && within < 2 / 3 ? 'station_d' : 'station_c';
  return legacy;
}
