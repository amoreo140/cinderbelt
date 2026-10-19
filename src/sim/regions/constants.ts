// Sectors (regions) over the rings – generator constants and shared types
// (sectors design, stage 0 – prototype).
//
// Every number of the region generator lives in REGION_GEN. **Frozen since stage 2** (save V15 stores
// `regions.gen = REGION_GEN_ID`): sector ids, shapes, security, start knowledge and survey points of a
// seed must never change under a saved game – golden tests (generator.golden.test.ts) guard it. A change
// of the generator is a new generator next to this one with a new id; a save keeps its own `gen`.

/** Seed layout variant (§2.2): A = concentric seed layers, B = blue noise like the station placement. */
export type RegionVariant = 'A' | 'B';
export const REGION_VARIANTS: readonly RegionVariant[] = ['A', 'B'];

/** Depth 1–4 (§0): the ring of the sector's seed; drives danger and feel from stage 1a. */
export type Depth = 1 | 2 | 3 | 4;

/** Security (§0, §2.4). `wild` is reserved for the outlook (M5a+) and never rolled now. */
export type Security = 'quiet' | 'guarded' | 'contested' | 'pirate';
export const SECURITIES: readonly Security[] = ['quiet', 'guarded', 'contested', 'pirate'];

/** Knowledge state of a sector (§3.3). */
export type Knowledge = 'charted' | 'reported' | 'uncharted';

/** One seed layer of variant A (§2.2 table). */
export interface SeedLayer {
  inner: number;
  outer: number;
  count: number;
  depth: Depth;
}

/** Ids of the region generators; a save stores the one its game was generated with (save V15). */
export type RegionGenId = 1;
export const REGION_GEN_IDS: readonly RegionGenId[] = [1];
/** The generator below (frozen in stage 2). */
export const REGION_GEN_ID: RegionGenId = 1;

export const REGION_GEN = {
  /** Generator revision inside one id – stays 0 (frozen); see REGION_GEN_ID. */
  revision: 0,
  /** The variant the game uses (stage 0 picks it with the "not a target" metric, §2.6). */
  variant: 'B' as RegionVariant,

  /** Variant A – concentric seed layers. Layer 0 is the fixed Origin seed at (0, 0). */
  layered: {
    layers: [
      { inner: 700, outer: 1500, count: 9, depth: 1 },
      { inner: 1500, outer: 2700, count: 10, depth: 2 },
      { inner: 2700, outer: 4000, count: 14, depth: 2 },
      { inner: 4000, outer: 6000, count: 16, depth: 3 },
      { inner: 6000, outer: 8000, count: 20, depth: 3 },
    ] as readonly SeedLayer[],
    /** Layers 6+ (depth 4): inner radius 8000 + width·k, cell count round(2π·r_mid / outerArc). */
    outerStart: 8000,
    outerWidth: 2000,
    outerArc: 2600,
    /** Seed radius as a share of the layer width. */
    radial: [0.2, 0.8] as readonly [number, number],
    /** Angular jitter of a seed (± share of its cell width). */
    angularJitter: 0.25,
    /** Seeds closer than this × the average spacing are pushed apart (one deterministic pass). */
    minSeparation: 0.6,
  },

  /** Variant B – blue noise (Matern II over a fine candidate grid, like `candidateAt` + `survives`). */
  blueNoise: {
    /** Target spacing by distance from home (piecewise linear knots [r, spacing]). */
    spacing: [
      [0, 820],
      [1300, 900],
      [2000, 1450],
      [3600, 1600],
      [4600, 2200],
      [7600, 2400],
      [8600, 2500],
    ] as readonly (readonly [number, number])[],
    /** Candidate grid cell (u): one candidate per cell, cell = min spacing / √2. */
    cell: 580,
    /**
     * A candidate survives when no stronger candidate is closer than `exclusion × spacing(r)`.
     * (The design's 0.8 assumed a sparse candidate grid; with one candidate per spacing/√2 cell
     * Matern II needs ~0.5 for an average cell area of ~0.9 spacing².)
     */
    exclusion: 0.5,
    /** No other seed closer than this to the Origin seed (keeps the home sector near variant A's size). */
    originClear: 750,
  },

  /** Power diagram weights: w ∈ [−weight, +weight] × s² (s = local average spacing). */
  weight: 0.04,

  /** Border warp: 2-octave value noise; amplitude = ampFactor × guaranteed minimum seed distance. */
  warp: {
    cell: 450,
    octaves: 2,
    ampFactor: 0.2,
    /**
     * Amplitude cap (u): the lattice stays 450 u everywhere, so a larger amplitude folds the warp and
     * leaves sector islands (200-seed flood fill, stage 0) – the design's ~110 u in P2.
     */
    maxAmp: 110,
    /** The warp fades in over this radius around home (keeps the home sector compact and round-free). */
    homeFade: 400,
  },

  /** Candidate tiles of `regionAt` (q-space, u). */
  tile: 500,
  /** LRU size of the chunk → region cache (§6.8). */
  chunkCache: 4096,

  /** Guild Lanes (§2.3). */
  lanes: {
    /** Corridor half-width around the lane line (u). */
    corridor: 250,
    /** Lane points closer to a fortress than this are pushed out perpendicular to the lane. */
    fortressClear: 900,
    /** A guild_relay landmark this close to a lane becomes a lane vertex. */
    relaySnap: 400,
    /** Lane B ends at this distance from home. */
    laneBEnd: 3400,
    /** Lane A turns onto the fortress axis at least this far out. */
    laneAAxisMin: 1800,
    /** …and at most this far when pushed out to keep the leg from G1 heading away from home (inside depth 2). */
    laneAAxisMax: 3000,
    /** A lane runs through a sector when at least this much of its line lies in it (u). */
    laneMin: 400,
    /** Densify step of the lane polylines (u). */
    step: 100,
    /** Pirate group multiplier inside the corridor. */
    corridorPirates: 0.2,
  },

  /** Security roll per depth (§2.4 table); depth 1 rolls only quiet/guarded (the corner is fixed). */
  roll: {
    1: { quiet: 0.5, guarded: 0.5, contested: 0, pirate: 0 },
    2: { quiet: 0, guarded: 0.15, contested: 0.7, pirate: 0.15 },
    3: { quiet: 0, guarded: 0.05, contested: 0.6, pirate: 0.35 },
    4: { quiet: 0, guarded: 0, contested: 0.6, pirate: 0.4 },
  } as Record<Depth, Record<Security, number>>,

  /** Group multiplier per security (§3.1); depth 1 guarded = 0. */
  groupMult: { quiet: 0, guarded: 0.5, contested: 1, pirate: 1.4 } as Record<Security, number>,

  /** Exposure balancing of depths 2 and 3 (§2.4): raster step and target ranges. */
  balance: {
    raster: 100,
    /** Depth-2/3 regions are rastered up to this distance from home. */
    rasterRadius: 10000,
    area: [0.95, 1.1] as readonly [number, number],
    cautious: [0.85, 1.0] as readonly [number, number],
    /**
     * Swap phases in order: Contested ↔ Pirate is the design's rule; Guarded ↔ Contested runs only
     * when the first phase cannot reach the ranges.
     */
    phases: [
      ['contested', 'pirate'],
      ['guarded', 'contested'],
    ] as readonly (readonly [Security, Security])[],
  },

  /**
   * Start knowledge (§3.3): lane sectors and the extra Reported depth-1 sector are added only while
   * the known share of r < radius stays ≤ budget and the largest unknown gap ≥ minGapDeg
   * (criterion 2.6.2 is 60 % / 60°; the margins keep it on every seed).
   */
  start: {
    radius: 1600,
    knownBudget: 0.55,
    minGapDeg: 70,
  },

  /**
   * Charting by flight coverage (§4.1, stage 1b): a sector is Charted once this share of its chunks
   * (chunk centre in the sector) is explored; crossing it pays small flat Data once, by depth
   * (depth 4+ pays nothing yet – its Data are in the outlook, §4.4). Start-Charted sectors pay nothing.
   * The design's 3 / 6 / 12 D are halved by its own rule (§6.4: the econ model showed Data/h P2 +19 %
   * instead of ≤ +6 %, tools/econ/econ-model.mjs `CHARTING`): 2 / 3 / 6 D.
   */
  charting: {
    coverage: 0.7,
    data: { 1: 2, 2: 3, 3: 6, 4: 0 } as Record<Depth, number>,
  },

  /**
   * Survey points (§4.1, stage 2): 3 / 4 / 5 per sector of depth 1 / 2 / 3 (none at depth 4+ and in
   * start-Charted sectors), preferably at a landmark, a POI (never a cache) or an asteroid cluster
   * centre, at least `spacing` apart and `margin` from the border. When a sector is too small for that,
   * the margin and the spacing relax step by step (`relax`). A scanner pulse within `range` of a point
   * marks it; all points of a sector = Charted.
   */
  survey: {
    points: { 1: 3, 2: 4, 3: 5, 4: 0 } as Record<Depth, number>,
    range: 150,
    spacing: 300,
    margin: 300,
    /** [margin, spacing] steps tried in order once the strict rule runs out of candidates. */
    relax: [
      [300, 300],
      [200, 250],
      [120, 200],
      [60, 150],
      [0, 120],
    ] as readonly (readonly [number, number])[],
    /** Directions sampled for the border distance of a candidate. */
    borderRays: 12,
  },

  /** Pirate corners (§2.4). */
  corner: {
    /** No pirate spawns closer to home than this, ever (§6.1). */
    pirateFreeRadius: 1000,
    /** Group chance per chunk in the depth-1 corner (only T1 Jackals). */
    depth1Rate: 0.05,
    /** The depth-2 corner's seed is closer to home than this. */
    depth2MaxSeedR: 2500,
  },
} as const;

/** Stable region id (§2.7): `rg:<variant>:<cell>`. */
export const regionId = (variant: RegionVariant, cell: string): string => `rg:${variant}:${cell}`;
