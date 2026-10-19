// World sites of M4b "The world comes alive" (M4b plan §2.1,
// §2.3–§2.5; long-term design §5.3.1–§5.3.3): abandoned (derelict) stations with three relays, ship
// graveyards with live mines and a sleeping pirate party, and comets on deterministic passes. Every
// number lives here – the logic is in src/sim/sites. The values are the starting tune; the econ/bot
// task (T15) may retune them within ±30 % and reports it.
//
// Hash streams: the sites come from their OWN streams (`SITE_SALT`, `COMET_SALT`), never from the
// POI / asteroid / pirate streams, so existing saves keep every station, POI, asteroid, fortress,
// landmark, Echo site, survey point and local condition exactly where it was (golden test
// src/sim/sites/golden.test.ts). New site kinds are NOT added to `POI_KINDS` / `POI_DENSITY`.
import type { EnemyKind } from '../sim/combat/types';
import type { Depth } from '../sim/regions/constants';
import type { ResourceId } from './resources';
import layoutsJson from './derelict_layouts.json';

/** Salt of the site placement stream: fnv1a32("m4poi"). Derelicts and graveyards per chunk. */
export const SITE_SALT = 0x95fd_99c0;
/** Salt of the comet stream: fnv1a32("m4comet"). Comet count, orbits and passes per seed. */
export const COMET_SALT = 0x2f7c_0650;

// ---------------------------------------------------------------------------
// layouts (art/blender/data/derelict_layouts.json, copied – derelictLayouts.test.ts guards the copy)

export type DerelictModel = 'a' | 'b' | 'c' | 'd';
export const DERELICT_MODELS: readonly DerelictModel[] = ['a', 'b', 'c', 'd'];

/** A collision circle in the local frame (+X = dock direction, +Y = left), game units. */
export interface LayoutCircle {
  x: number;
  y: number;
  r: number;
}

/** Geometry of a derelict station model (local frame, rotated by the site's angle). */
export interface DerelictLayout {
  /** Station radius R; the dock port lies at (R, 0) – a `DockTarget` radius. */
  radius: number;
  circles: readonly LayoutCircle[];
  dockPort: { x: number; y: number };
  /** No asteroid / other site inside this radius. */
  clearRadius: number;
}

/** Geometry of a relay mast (local frame, rotated by the relay's angle). */
export interface RelayLayout {
  circles: readonly LayoutCircle[];
  clearRadius: number;
  /** The receiver lens the mining beam is held on (z = height above the plane, render only). */
  powerTarget: { x: number; y: number; z: number };
}

const layouts = layoutsJson as unknown as Record<`derelict_${DerelictModel}`, DerelictLayout> & { derelict_relay: RelayLayout };

export const DERELICT_LAYOUTS: Readonly<Record<DerelictModel, DerelictLayout>> = {
  a: layouts.derelict_a,
  b: layouts.derelict_b,
  c: layouts.derelict_c,
  d: layouts.derelict_d,
};
export const RELAY_LAYOUT: RelayLayout = layouts.derelict_relay;

// ---------------------------------------------------------------------------
// placement (§2.1)

export const SITES = {
  /** No site within this distance of home (u). */
  homeClear: 1_000,
  /** Candidate positions drawn per site and chunk; the first one that fits is taken. */
  candidates: 5,
  /** Extra gap kept beyond the clear circles of stations, POIs, rocks, fortresses, landmarks, Echo sites, survey points (u). */
  margin: 20,
  /** Extra gap to a fortress's clear radius (u). */
  fortressMargin: 150,
  /** No derelict within this distance of a Guild Lane's `guild_relay` landmark (keeps the M4d Guild relay site free, §8). */
  guildRelayClear: 300,
  /** Candidate positions keep this far from the chunk's edges (u). */
  chunkMargin: 30,
  derelict: {
    /** Chance of a derelict per chunk by the depth of the chunk's sector (= econ model `POI.derelict`); 0 in statically Guarded sectors. */
    density: { 1: 0, 2: 0.005, 3: 0.01, 4: 0.015 } as Record<Depth, number>,
    /** Data for the first berth (= econ model `POI.derelict.d`). */
    data: 80,
    /** Defence rolled per derelict; wakes when the 2nd relay lights. */
    defence: { sentries: 0.45, storm: 0.25, none: 0.3 },
    /** Sentry drones by depth (T1 at depth 2, T2 from depth 3). */
    sentries: { 1: 2, 2: 2, 3: 3, 4: 3 } as Record<Depth, number>,
    sentryT2FromDepth: 3 as Depth,
    /** Sentries attack within this distance of the derelict and never leave it farther than `leash` (u). */
    guardRadius: 160,
    leash: 260,
    /** Local ion storm defence: duration (s) and radius around the derelict (u). */
    storm: { seconds: 75, radius: 400 },
    /** The one-time terminal service rolled per derelict. */
    service: { stash: 0.45, plan: 0.3, fabricator: 0.25 },
    /** Stash: 2–3 parts, T1 at depth 2 / T2 from depth 3; this share of them is a variant the player may not have unlocked. */
    stashParts: [2, 3] as readonly [number, number],
    stashT2FromDepth: 3 as Depth,
    stashVariantChance: 0.2,
    /** Plan: fragments of one plan via `awardFragment` (source 'derelict'). */
    planFragments: 2,
    /** Fabricator: one craft of a part up to this tier, materials from the ship's cargo, no fee. */
    fabricatorMaxTier: 2,
    /** Cargo units one taken part uses in the ship's part hold (`player.salvage`). */
    itemCargo: 10,
  },
  graveyard: {
    /** Chance of a graveyard per chunk by depth; ×`biomeMult` in the `wreckField` biome; 0 in statically Guarded sectors. */
    density: { 1: 0, 2: 0.003, 3: 0.005, 4: 0.01 } as Record<Depth, number>,
    biomeMult: 3,
    /** Field radius = the site's clear circle (u). */
    radius: 200,
    wrecks: [10, 20] as readonly [number, number],
    classWeights: { pirate: 0.4, freighter: 0.35, miner: 0.25 },
    /** Wreck size 0 / 1 / 2. */
    sizeWeights: [0.3, 0.45, 0.25] as readonly [number, number, number],
    wreckT2FromDepth: 3 as Depth,
    containersMax: 6,
    /**
     * Data for the first analysis of any wreck of a graveyard (once); other graveyard wreck scans give 0 D
     * (= econ model `POI.graveyard.d`). T15 retune 40 → 35: with 40 D the M4b sites raised the model's P2 Data/h
     * by 10.3 % over the game without them (overview M4b: ≤ +10 %), with 35 D by 9.8 %.
     */
    data: 35,
    /** At most this many fragment rolls per graveyard (the first wrecks looted). */
    fragmentRolls: 2,
    /** Graveyard wrecks spawn within this distance of the player (render budget, not the 450 u spawn radius). */
    spawnRadius: 300,
    /** Live mines by depth [min, max]. */
    mines: { 1: [0, 0], 2: [4, 5], 3: [6, 6], 4: [8, 8] } as Record<Depth, readonly [number, number]>,
    /** Sleeping party chance and members by depth (T2 from `sleeperT2FromDepth`). */
    sleeperChance: { 1: 0, 2: 0.5, 3: 0.7, 4: 0.7 } as Record<Depth, number>,
    sleeperParty: {
      1: [],
      2: ['hammer', 'jackal'],
      3: ['hammer', 'jackal', 'gunner'],
      4: ['hammer', 'jackal', 'gunner'],
    } as Record<Depth, readonly EnemyKind[]>,
    sleeperT2FromDepth: 4 as Depth,
    /** Sleepers wake: player within `wakeRange` of one; a graveyard wreck within `wakeWreckRange` cut or towed; a sleeper hit; a mine blowing within `wakeWreckRange`. */
    wakeRange: 60,
    wakeWreckRange: 150,
  },
} as const;

export const DERELICT = SITES.derelict;
export const GRAVEYARD = SITES.graveyard;

// ---------------------------------------------------------------------------
// relays (§2.4) – generic: derelict relays now, the Guild relay of M4d reuses them unchanged

export const RELAY = {
  /** Relays per derelict. */
  count: 3,
  /** Distance from the derelict (u). */
  distance: [60, 120] as readonly [number, number],
  /** Spacing 120° ± 25°. */
  spacingDeg: 120,
  jitterDeg: 25,
  /** Seconds of a mining beam on the receiver to power a relay (total, any beam). */
  powerSeconds: 5,
  /** Charge lost per second without a beam (seconds of charge per second, like CUT_DECAY). */
  decayPerSecond: 0.5,
  /** Radius of the receiver circle around `RELAY_LAYOUT.powerTarget` (u). */
  targetRadius: 1.2,
  /** The derelict's defence wakes when this many relays are lit. */
  wakeAt: 2,
} as const;

// ---------------------------------------------------------------------------
// comets (§2.3)

export const COMET = {
  /** Comets per seed by the depth band of their perihelion. */
  count: { 1: 2, 2: 4, 3: 6, 4: 4 } as Record<Depth, number>,
  /** Orbit period (game minutes). */
  periodMinutes: [40, 120] as readonly [number, number],
  /** Speed along the pass (u/s). */
  speed: [30, 55] as readonly [number, number],
  /** Length of a pass (s) – long-term design §5.5 "Comet flyby 2–5 min". */
  passSeconds: [120, 300] as readonly [number, number],
  /** Perihelion weight of depth-3 `cometPath` biome sectors. */
  cometPathWeight: 3,
  /** The arc keeps this far from stations and fortresses (u); its middle third lies outside Guild Lane corridors. */
  clear: 300,
  /** Re-rolls of a rejected arc from a sub-stream, then the perihelion is shifted along the band. */
  rerolls: 8,
  /** Collision and mining circle of the nucleus (≈ comet_nucleus.glb in game scale; verify in T2/T12). */
  nucleusRadius: 6,
  /** The nucleus is mined like a rock at this grade (rich – nuggets per Mining 2.0). */
  grade: 1.5,
  /** Rock units of the nucleus per pass and the ore mix. He3 / Kr only from M5a/M5b. */
  budget: 360,
  mix: { ice: 0.6, titanium: 0.4 } as Partial<Record<ResourceId, number>>,
  tail: {
    /** Ice shards behind the nucleus (away from home), not colliding, each mined once per pass. */
    shards: 24,
    radius: [0.8, 1.5] as readonly [number, number],
    /** Ice units per shard. */
    units: 8,
    /** Tail length (u). */
    length: 30,
  },
  /** "Nearest flyby near you": the next time the comet comes within this distance of a point (u)… */
  nearRange: 1_000,
  /** …searched over this many periods. */
  nearSearchPeriods: 2,
} as const;

/** Archive "Vein analyser" (`veinAnalyzer`): the ore assay and a comet's composition reach this × radar range. */
export const VEIN_ANALYZER = { assayRangeMult: 2 } as const;

// ---------------------------------------------------------------------------
// live mines (§2.5)

export const MINE = {
  /** Visible on the radar within this distance (red). */
  radarRange: 80,
  /** A ship (player or pirate) this close arms the mine. */
  armRange: 12,
  /** Fast blink after arming, then the blast (s). */
  fuseSeconds: 1.5,
  /** Blast: damage at the centre, falls off linearly to 0 at `blastRadius` (CUT_BLAST damage path, cause 'hazard'). */
  damage: 30,
  blastRadius: 10,
  /** Collision / projectile circle of a mine (u); a projectile hit detonates it at once. */
  radius: 1.2,
} as const;
