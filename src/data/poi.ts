// Points of interest (long-term design 5.3) and Data for exploration (3.2.2) as data. The densities and the Data for a
// visit are the same numbers as in the econ model (tools/econ/econ-model.mjs, `POI`) –
// src/data/econOracle.test.ts keeps them in line. POIs from later milestones (abandoned stations, planets)
// are not here yet.
import type { RingIndex } from './economy';
import type { ResourceId } from './resources';

/** POI kinds generated per chunk in M3.5b. */
export type PoiKind = 'wreck' | 'anomaly' | 'cache' | 'giant';
export const POI_KINDS: readonly PoiKind[] = ['wreck', 'anomaly', 'cache', 'giant'];

/** POI probability per chunk by ring (5.3; after excluding stations). */
export const POI_DENSITY: Record<PoiKind, Record<RingIndex, number>> = {
  wreck: { 1: 0.03, 2: 0.06, 3: 0.07, 4: 0.08 },
  anomaly: { 1: 0.01, 2: 0.03, 3: 0.05, 4: 0.06 },
  cache: { 1: 0.01, 2: 0.02, 3: 0.02, 4: 0.02 },
  giant: { 1: 0, 2: 0.02, 3: 0.03, 4: 0.02 },
};

/** No POI closer to home (a calm start, the map stays readable). */
export const POI_HOME_CLEAR = 600;
/** POI distance from the chunk edge, from a station (beyond its free circle) and from another POI. */
export const POI_CHUNK_MARGIN = 30;
export const POI_STATION_CLEAR = 60;
export const POI_SPACING = 60;

// ---------------------------------------------------------------------------
// Data (3.2.2) – neither sold nor bought

/** Data for the first analysis / discovery by source. */
export const DATA_REWARDS = {
  /** Wreck scan before dismantling (each wreck once). */
  wreck: 15,
  /** Anomaly scan by ring (each once). */
  anomaly: { 1: 25, 2: 35, 3: 45, 4: 60 } as Record<RingIndex, number>,
  /** A cache found by triangulation. */
  cache: 20,
  /** Giant asteroid (core scan). */
  giant: 10,
  /** Scan of a new asteroid type (once per type). */
  asteroidType: 10,
  /** Forge-smith Echo (story). */
  echo: 100,
  /** A blueprint fragment the player already has complete (a lesson from Astroneer). */
  duplicateFragment: 30,
} as const;

/** Institute contracts: Data per hour of the contract estimate by ring (an endless floor). */
export const INSTITUTE_DATA_RATE: Record<RingIndex, number> = { 1: 150, 2: 250, 3: 400, 4: 500 };

/** Data for visiting a POI of the given kind in a ring (for the model and the overview). */
export const poiData = (kind: PoiKind, ring: RingIndex): number => {
  const d = DATA_REWARDS[kind];
  return typeof d === 'number' ? d : d[ring];
};

// ---------------------------------------------------------------------------
// wrecks (5.3.1)

/** Wreck class – determines the shape, the loot and the fragment table (weighted by type, 3.2.3). */
export type WreckClass = 'miner' | 'freighter' | 'pirate';
export const WRECK_CLASSES: readonly WreckClass[] = ['miner', 'freighter', 'pirate'];
/** Wreck class weights by ring (in P1 almost only miners). */
export const WRECK_CLASS_WEIGHTS: Record<RingIndex, Record<WreckClass, number>> = {
  1: { miner: 0.7, freighter: 0.3, pirate: 0 },
  2: { miner: 0.4, freighter: 0.3, pirate: 0.3 },
  3: { miner: 0.35, freighter: 0.3, pirate: 0.35 },
  4: { miner: 0.3, freighter: 0.3, pirate: 0.4 },
};
/** Wreck parts have 30–70 % HP – only a few are intact (the rest is scrap). */
export const WRECK_INTACT_PARTS: readonly [number, number] = [1, 3];
/** Resource scrap in a wreck by size (u of iron; copper and titanium proportionally). */
export const WRECK_SCRAP: readonly [number, number, number] = [8, 16, 28];

// ---------------------------------------------------------------------------
// anomalies (5.3, 5.5): scanned (Data) and usable – flying through the core gives a short bonus

export type AnomalyType = 'gravity' | 'ion' | 'radiation' | 'time';
export const ANOMALY_TYPES: readonly AnomalyType[] = ['gravity', 'ion', 'radiation', 'time'];

/** Short bonus from flying through an anomaly core. */
export type BuffKind = 'sling' | 'charge' | 'irradiated' | 'echo';
export const BUFF_KINDS: readonly BuffKind[] = ['sling', 'charge', 'irradiated', 'echo'];

export interface AnomalyDef {
  type: AnomalyType;
  /** Weight when drawing the type. */
  weight: number;
  /** Field radius (u) – gravity inside it attracts. */
  field: number;
  /** Core radius (u) – flying through it gives the bonus. */
  core: number;
  buff: BuffKind;
  /** Bonus duration (s). */
  seconds: number;
}

export const ANOMALIES: Record<AnomalyType, AnomalyDef> = {
  // sling: thrust ×1.5 (Archive "Sling+" extends the duration)
  gravity: { type: 'gravity', weight: 3, field: 70, core: 14, buff: 'sling', seconds: 15 },
  // ion charge: charges the battery, energy production ×2.5 – the shield in the core drops
  ion: { type: 'ion', weight: 3, field: 55, core: 12, buff: 'charge', seconds: 30 },
  // irradiation: pulse range ×1.5 – the core damages the part nearest to the anomaly
  radiation: { type: 'radiation', weight: 2, field: 50, core: 12, buff: 'irradiated', seconds: 60 },
  // time echo: lasers do not overheat, the scanner charges twice as fast
  time: { type: 'time', weight: 2, field: 50, core: 11, buff: 'echo', seconds: 45 },
};

/** Bonus effects (multipliers). */
export const BUFFS = {
  sling: { thrustMult: 1.5 },
  charge: { energyGenMult: 2.5 },
  irradiated: { pulseRangeMult: 1.5 },
  echo: { pulseCooldownMult: 0.5 },
} as const;

// Kept below the forward acceleration of every laden T1/T2 ship of the main path (≥ ~2.7 u/s²), so full
// thrust always climbs out of a well (bot report F3: 6 u/s² trapped laden ships).
/** Gravity anomaly: acceleration towards the centre at the core edge (u/s²), falling to 0 at the field edge. */
export const GRAVITY_PULL = 2.5;
/** Damage to a part when flying through the core of a radiation anomaly. */
export const RADIATION_HIT = 8;
/** The core of the same anomaly gives the bonus again only after this time (s). */
export const ANOMALY_RECHARGE_SECONDS = 5 * 60;
/** Archive "Sling+": multiplier of the sling duration. */
export const SLING_PLUS_MULT = 2;

// ---------------------------------------------------------------------------
// giant asteroids (5.3): a 300 HP shell – only a heavy laser or a cannon breaks it; the core is a rare resource

export const GIANT_SHELL_HP = 300;
/** Shell and core radius (u; the model has a radius of ~5.3 → ×2). */
export const GIANT_RADIUS = 11;
export const GIANT_CORE_RADIUS = 6.5;
/** Core stock (u of resource; an ordinary asteroid has up to ~400). */
export const GIANT_CORE_AMOUNT = 900;
/** The heavy laser breaks the shell: HP per second = laser mining × this. */
export const GIANT_LASER_DAMAGE = 3;
/** The core is richer – mining ×1.5. */
export const GIANT_CORE_YIELD = 1.5;
/** Core resource by ring (rarer than the surroundings). */
export const GIANT_RESOURCES: Record<RingIndex, Partial<Record<ResourceId, number>>> = {
  1: { iron: 0.5, copper: 0.5 },
  2: { titanium: 0.5, copper: 0.3, iron: 0.1, ice: 0.1 },
  3: { titanium: 0.6, copper: 0.2, ice: 0.2 },
  4: { titanium: 0.6, copper: 0.2, ice: 0.2 },
};

// ---------------------------------------------------------------------------
// caches (5.3.4): invisible on the radar, the scanner shows an uncertainty circle and triangulation shrinks it

export const CACHE = {
  /** Polomer kruhu neistoty po prvom pulze (j). */
  firstRadius: 300,
  /** A pulse from a new place shrinks the circle to this share. */
  shrink: 0.4,
  /** "Another place" = at least this far from all earlier pulses that caught the cache (u). */
  baseline: 120,
  /** Below this radius the position is exact (the cache appears). */
  revealRadius: 25,
  /** The cache opens (F) from this gap to the ship (u). */
  openRange: 10,
  /** Loot: credits and resources. */
  credits: [250, 900] as readonly [number, number],
  resources: [10, 40] as readonly [number, number],
  /** Chance of a blueprint fragment (+ bad-luck protection as with wrecks). */
  fragmentChance: 0.5,
} as const;
