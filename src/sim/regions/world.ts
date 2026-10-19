// The region world – the generation DAG of §2.5 in one place:
//
//   seed ─► seeds + depth ─► cells (power + warp) ─┬─► adjacency (adjacency.ts, on demand)
//            (variant A/B)                          │
//   stations, POIs, fortresses, landmarks (inputs) ─┼─► lanes (bent around fortresses) ─► corridors
//                                                   │
//                                                   └─► security: fixed → roll (hash id)
//                                                        → balancing (raster 100 u, per depth)
//                                                        ─► [stage 1a+: names, survey points, spawns]
//
// Stations, POIs, asteroids, fortresses and landmarks are read, never moved (§6.7). Everything is a
// pure function of (seed, variant, inputs), cached per (seed, variant).
import { PIRATE_GROUPS, SCAVENGER } from '../../data/pirates';
import { hypot, type Vec2 } from '../math/vec2';
import { fortressSites } from '../pirates/sites';
import { landmarkSites } from '../world/landmarks';
import { guaranteedStationChunks, stationAt, stationsInArea } from '../world/stations';
import { packedChunkKey } from '../world/chunkMemo';
import { CHUNK_SIZE, chunkCoord } from '../world/chunks';
import { REGION_GEN, type Depth, type Knowledge, type RegionVariant, type Security } from './constants';
import { regionField, type RegionField, type RegionSeed } from './field';
import { guildLanes, laneDistance, type GuildLane } from './lanes';
import { balanceDepth, regionHash, rollSecurity, type BalanceRegion, type BalanceReport } from './security';

/** A landmark as the sectors see it – a structural subset of `LandmarkSite` (tests pass their own). */
export interface RegionLandmark {
  id: string;
  kind: string;
  pos: Vec2;
}

/** The world content the sectors read (never change). */
export interface RegionInputs {
  fortresses: readonly { id: string; pos: Vec2 }[];
  /** Stations around home (the depth-1 area at least), incl. home, G1 and G2. */
  stations: readonly { id: string; pos: Vec2 }[];
  g1: Vec2;
  g2: Vec2;
  landmarks: readonly RegionLandmark[];
}

/** Why a sector's security is fixed (§2.4). */
export type FixedReason = 'origin' | 'fortress' | 'corner1' | 'corner2';

export interface RegionInfo {
  seed: RegionSeed;
  /** Rastered area (u², raster 100 u up to `balance.rasterRadius`). */
  area: number;
  /** Area inside a Guild Lane corridor. */
  corridorArea: number;
  /** A lane line runs through the sector. */
  onLane: boolean;
  /** A station lies in the sector (only tracked for the depth-1 area and the guaranteed stations). */
  hasStation: boolean;
  /** Security after fixed rules, roll and balancing (an untouched world – no destroyed fortress). */
  security: Security;
  fixed: FixedReason | null;
  /** Landmark ids anchored in the sector. */
  landmarks: string[];
}

export interface RegionWorld {
  seed: number;
  variant: RegionVariant;
  /** The world content it was built from (read only). */
  inputs: RegionInputs;
  field: RegionField;
  lanes: GuildLane[];
  /** The finite sectors of depths 1–3 (rastered), sorted by key. */
  regions: RegionInfo[];
  corners: { depth1: string | null; depth2: string | null };
  balance: Partial<Record<Depth, BalanceReport>>;
  /** Fortress id → its sector id. */
  fortressRegions: Map<string, string>;
  /** Landmark id → its sector id. */
  landmarkRegions: Map<string, string>;
  /** Sectors known at the start of a game (§3.3). */
  startKnowledge: Map<string, Knowledge>;
  info(id: string): RegionInfo | null;
}

/** The inputs of a seed from the existing world generators (landmarks: `landmarkSites(seed)` unless given). */
export function defaultRegionInputs(seed: number, landmarks: readonly RegionLandmark[] = landmarkSites(seed)): RegionInputs {
  const [c1, c2] = guaranteedStationChunks(seed);
  const s1 = stationAt(seed, c1.cx, c1.cy);
  const s2 = stationAt(seed, c2.cx, c2.cy);
  const R = chunkCoord(2600);
  const stations = stationsInArea(seed, -R, R, -R, R).map((s) => ({ id: s.id, pos: s.pos }));
  for (const s of [s1, s2]) if (s && !stations.some((t) => t.id === s.id)) stations.push({ id: s.id, pos: s.pos });
  return {
    fortresses: fortressSites(seed).map((f) => ({ id: f.id, pos: f.pos })),
    stations,
    g1: s1?.pos ?? { x: 1000, y: 0 },
    g2: s2?.pos ?? { x: -2400, y: 0 },
    landmarks,
  };
}

/** Build the region world (uncached – see `regionWorld`). */
export function buildRegionWorld(seed: number, variant: RegionVariant, inputs: RegionInputs): RegionWorld {
  const field = regionField(seed, variant);

  // lanes (relay from the landmarks, bent around fortresses)
  const relay = inputs.landmarks.find((l) => l.kind === 'guild_relay')?.pos ?? null;
  const lanes = guildLanes({
    g1: inputs.g1,
    g2: inputs.g2,
    fortresses: inputs.fortresses.map((f) => f.pos),
    relay,
    depthAt: (x, y) => field.regionAt(x, y).depth,
  });

  // raster: area and corridor area of every sector of depth 1–3
  const step = REGION_GEN.balance.raster;
  const R = REGION_GEN.balance.rasterRadius;
  const stats = new Map<number, { seed: RegionSeed; area: number; corridorArea: number }>();
  const cell = step * step;
  for (let y = -R + step / 2; y < R; y += step) {
    for (let x = -R + step / 2; x < R; x += step) {
      if (x * x + y * y > R * R) continue;
      const s = field.regionAt(x, y);
      if (s.depth > 3) continue;
      let st = stats.get(s.key);
      if (!st) {
        st = { seed: s, area: 0, corridorArea: 0 };
        stats.set(s.key, st);
      }
      st.area += cell;
      if (laneDistance(lanes, x, y) <= REGION_GEN.lanes.corridor) st.corridorArea += cell;
    }
  }

  // lane lines: how long they run through each sector (sampled every 25 u); a lane that only clips
  // a corner (< laneMin) does not count as running through the sector
  const laneLength = new Map<string, number>();
  for (const lane of lanes) {
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1]!;
      const b = lane.points[i]!;
      const len = hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len / 25));
      for (let k = 0; k < n; k++) {
        const id = field.regionAt(a.x + ((b.x - a.x) * (k + 0.5)) / n, a.y + ((b.y - a.y) * (k + 0.5)) / n).id;
        laneLength.set(id, (laneLength.get(id) ?? 0) + len / n);
      }
    }
  }
  const onLane = new Set([...laneLength].filter(([, len]) => len >= REGION_GEN.lanes.laneMin).map(([id]) => id));
  const stationRegions = new Set(inputs.stations.map((s) => field.regionAt(s.pos.x, s.pos.y).id));
  const fortressRegions = new Map(inputs.fortresses.map((f) => [f.id, field.regionAt(f.pos.x, f.pos.y).id]));
  const fortressSet = new Set(fortressRegions.values());
  const landmarkRegions = new Map(inputs.landmarks.map((l) => [l.id, field.regionAt(l.pos.x, l.pos.y).id]));

  const regions: RegionInfo[] = [...stats.values()]
    .sort((a, b) => a.seed.key - b.seed.key)
    .map((st) => ({
      seed: st.seed,
      area: st.area,
      corridorArea: st.corridorArea,
      onLane: onLane.has(st.seed.id),
      hasStation: stationRegions.has(st.seed.id),
      security: rollSecurity(seed, st.seed.id, st.seed.depth),
      fixed: null,
      landmarks: [],
    }));
  const byId = new Map(regions.map((r) => [r.seed.id, r]));
  for (const [lid, rid] of landmarkRegions) byId.get(rid)?.landmarks.push(lid);

  // fixed elements (§2.4): Origin, fortress sectors, the two pirate corners
  const fix = (r: RegionInfo | undefined, security: Security, reason: FixedReason) => {
    if (!r) return;
    r.security = security;
    r.fixed = reason;
  };
  fix(byId.get(field.origin.id), 'guarded', 'origin');
  for (const id of fortressSet) if (id !== field.origin.id) fix(byId.get(id), 'pirate', 'fortress');

  const byHash = (a: RegionInfo, b: RegionInfo) => regionHash(seed, a.seed.id, 1) - regionHash(seed, b.seed.id, 1);
  const free = (r: RegionInfo) => r.fixed === null;
  const depth1 = regions.filter((r) => r.seed.depth === 1 && !r.seed.origin && free(r));
  // corner 1: depth 1, not Origin, no station, no lane through it; fallbacks: smallest without a
  // station (corridor-free first), then the smallest depth-1 sector
  let corner1 = depth1.filter((r) => !r.hasStation && !r.onLane).sort(byHash)[0];
  corner1 ??= depth1
    .filter((r) => !r.hasStation)
    .sort((a, b) => Number(a.corridorArea > 0) - Number(b.corridorArea > 0) || a.area - b.area || a.seed.key - b.seed.key)[0];
  corner1 ??= [...depth1].sort((a, b) => a.area - b.area || a.seed.key - b.seed.key)[0];
  fix(corner1, 'pirate', 'corner1');
  // corner 2: depth 2, seed within 2 500 u, the corridor touches it but no lane runs through it;
  // fallback: the one with the seed nearest to a lane
  const depth2 = regions.filter((r) => r.seed.depth === 2 && free(r) && hypot(r.seed.x, r.seed.y) < REGION_GEN.corner.depth2MaxSeedR);
  let corner2 = depth2.filter((r) => r.corridorArea > 0 && !r.onLane).sort(byHash)[0];
  corner2 ??= [...depth2].sort(
    (a, b) => laneDistance(lanes, a.seed.x, a.seed.y, Infinity) - laneDistance(lanes, b.seed.x, b.seed.y, Infinity) || a.seed.key - b.seed.key,
  )[0];
  fix(corner2, 'pirate', 'corner2');

  // balancing of depths 2 and 3 (depth 4+ is infinite and only rolled)
  const balance: Partial<Record<Depth, BalanceReport>> = {};
  for (const depth of [2, 3] as const) {
    const list: BalanceRegion[] = regions
      .filter((r) => r.seed.depth === depth)
      .map((r) => ({ id: r.seed.id, depth, area: r.area, corridorArea: r.corridorArea, security: r.security, fixed: r.fixed !== null }));
    balance[depth] = balanceDepth(depth, list);
    for (const b of list) byId.get(b.id)!.security = b.security;
  }

  const startKnowledge = startingKnowledge(field, lanes, regions, corner1, corner2, fortressSet);
  return {
    seed,
    variant,
    inputs,
    field,
    lanes,
    regions,
    corners: { depth1: corner1?.seed.id ?? null, depth2: corner2?.seed.id ?? null },
    balance,
    fortressRegions,
    landmarkRegions,
    startKnowledge,
    info: (id) => byId.get(id) ?? null,
  };
}

/**
 * Knowledge at the start of a game (§3.3), derived from the seed:
 *  - always: Charted Origin and the sector of lane A's first leg; Reported both corners and the
 *    fortress sectors (the red spots of the start story);
 *  - then the sectors a lane runs through (≥ `lanes.laneMin`), nearest along the lanes first, and
 *    finally the smallest remaining depth-1 sector – each one only while the start map keeps enough
 *    "unknown" near home (criterion 2.6.2: known share of r < `start.radius` ≤ `start.knownBudget`,
 *    largest unknown gap ≥ `start.minGapDeg`). Lane sectors that miss the disc are always Reported.
 * Everything else is Uncharted.
 */
function startingKnowledge(
  field: RegionField,
  lanes: readonly GuildLane[],
  regions: readonly RegionInfo[],
  corner1: RegionInfo | undefined,
  corner2: RegionInfo | undefined,
  fortressSet: ReadonlySet<string>,
): Map<string, Knowledge> {
  const out = new Map<string, Knowledge>();
  out.set(field.origin.id, 'charted');
  const laneA = lanes.find((l) => l.id === 'A');
  if (laneA) {
    for (const p of laneA.points) {
      const id = field.regionAt(p.x, p.y).id;
      if (id !== field.origin.id) {
        out.set(id, 'charted');
        break;
      }
    }
  }
  const report = (id: string | undefined) => {
    if (id && !out.has(id)) out.set(id, 'reported');
  };
  report(corner1?.seed.id);
  report(corner2?.seed.id);
  for (const id of [...fortressSet].sort()) report(id);

  const sampler = startSampler(field);
  const fits = (id: string): boolean => {
    const known = new Set(out.keys());
    known.add(id);
    return sampler.share(known) <= REGION_GEN.start.knownBudget && sampler.gap(known) >= REGION_GEN.start.minGapDeg;
  };
  // lane sectors in the order the lanes enter them (path distance from home, both lanes merged)
  const onLane = new Set(regions.filter((r) => r.onLane).map((r) => r.seed.id));
  const entry = new Map<string, number>();
  for (const lane of lanes) {
    let dist = 0;
    for (let i = 0; i < lane.points.length; i++) {
      const p = lane.points[i]!;
      if (i > 0) dist += hypot(p.x - lane.points[i - 1]!.x, p.y - lane.points[i - 1]!.y);
      const id = field.regionAt(p.x, p.y).id;
      if (onLane.has(id) && !(entry.get(id)! <= dist)) entry.set(id, dist);
    }
  }
  for (const id of onLane) if (!entry.has(id)) entry.set(id, Infinity);
  const laneOrder = [...entry].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id]) => id);
  for (const id of laneOrder) if (!out.has(id) && (!sampler.touches(id) || fits(id))) report(id);
  // the extra one is the smallest unknown depth-1 sector
  const extra = regions
    .filter((r) => r.seed.depth === 1 && !out.has(r.seed.id))
    .sort((a, b) => a.area - b.area || a.seed.key - b.seed.key)[0];
  if (extra && fits(extra.seed.id)) report(extra.seed.id);
  return out;
}

/** Sector ids sampled over the start disc and along rays (criterion 2.6.2, like `startMapReport`). */
interface StartSampler {
  /** Known share of the disc r < `start.radius`. */
  share(known: ReadonlySet<string>): number;
  /** Largest run of directions (deg) whose rays (r 700 … radius) are mostly unknown. */
  gap(known: ReadonlySet<string>): number;
  /** The sector has a sample in the disc. */
  touches(id: string): boolean;
}

function startSampler(field: RegionField): StartSampler {
  const R = REGION_GEN.start.radius;
  const step = 50;
  const disc: string[] = [];
  for (let y = -R + step / 2; y < R; y += step) {
    for (let x = -R + step / 2; x < R; x += step) if (x * x + y * y <= R * R) disc.push(field.regionAt(x, y).id);
  }
  const rays: string[][] = [];
  for (let a = 0; a < 360; a++) {
    const cx = Math.cos((a * Math.PI) / 180);
    const cy = Math.sin((a * Math.PI) / 180);
    const ray: string[] = [];
    for (let r = 700; r <= R; r += step) ray.push(field.regionAt(cx * r, cy * r).id);
    rays.push(ray);
  }
  const inDisc = new Set(disc);
  return {
    share: (known) => disc.reduce((n, id) => n + (known.has(id) ? 1 : 0), 0) / disc.length,
    gap: (known) => {
      const unknown = rays.map((ray) => ray.reduce((n, id) => n + (known.has(id) ? 0 : 1), 0) * 2 > ray.length);
      if (unknown.every(Boolean)) return 360;
      const first = unknown.indexOf(false);
      let gap = 0;
      let run = 0;
      for (let i = 1; i <= 360; i++) {
        if (unknown[(first + i) % 360]) gap = Math.max(gap, ++run);
        else run = 0;
      }
      return gap;
    },
    touches: (id) => inDisc.has(id),
  };
}

/** Share of the disc r < `start.radius` (raster 100 u) that lies in the given sectors. */
export function knownShareNearHome(field: RegionField, known: ReadonlySet<string>): number {
  const R = REGION_GEN.start.radius;
  const step = 100;
  let all = 0;
  let hit = 0;
  for (let y = -R + step / 2; y < R; y += step) {
    for (let x = -R + step / 2; x < R; x += step) {
      if (x * x + y * y > R * R) continue;
      all++;
      if (known.has(field.regionAt(x, y).id)) hit++;
    }
  }
  return all > 0 ? hit / all : 0;
}

const worlds = new Map<string, RegionWorld>();
/** The last answer of `regionWorld` – nearly every call asks for the game's own seed (no key string per call). */
let lastWorld: { seed: number; variant: RegionVariant; world: RegionWorld } | null = null;

/** The region world of a seed and variant from the existing world content (cached). */
export function regionWorld(seed: number, variant: RegionVariant = REGION_GEN.variant): RegionWorld {
  if (lastWorld !== null && lastWorld.seed === seed && lastWorld.variant === variant) return lastWorld.world;
  const w = regionWorldOf(seed, variant);
  lastWorld = { seed, variant, world: w };
  return w;
}

function regionWorldOf(seed: number, variant: RegionVariant): RegionWorld {
  const key = `${seed}:${variant}`;
  const hit = worlds.get(key);
  if (hit) return hit;
  const w = buildRegionWorld(seed, variant, defaultRegionInputs(seed));
  if (worlds.size >= 8) worlds.clear();
  worlds.set(key, w);
  return w;
}

/** Security of any sector – the finite ones from the world, depth 4+ by roll only (§2.4). */
export function securityOf(world: RegionWorld, seed: RegionSeed): Security {
  return world.info(seed.id)?.security ?? rollSecurity(world.seed, seed.id, seed.depth);
}

/**
 * What changes a sector's security during a game (M4d plan §2.1), on top of the static security: the
 * fortresses destroyed now (`pirates.fortresses`) and the sectors secured by a Guild relay
 * (`guild.relays`). Both derived from the saved state – `securityOverrides(state)` builds them.
 */
export interface SecurityOverrides {
  destroyedFortresses: ReadonlySet<string>;
  /** Sector ids secured by a Guild relay (stage `secured`). */
  secured: ReadonlySet<string>;
}

/** No overrides: an untouched world (every fortress standing, no sector secured). */
export const NO_SECURITY_OVERRIDES: SecurityOverrides = { destroyedFortresses: new Set(), secured: new Set() };

/**
 * Security now: a fortress sector turns Contested once its fortresses are all destroyed; a Contested
 * sector secured by a Guild relay is Guarded. `secured` never changes a Pirate, Quiet, Guarded or
 * fortress sector (the relay chain never offers one) – the balancing stays a function of the seed.
 */
export function currentSecurity(world: RegionWorld, seed: RegionSeed, overrides: SecurityOverrides): Security {
  const base = securityOf(world, seed);
  if (world.info(seed.id)?.fixed === 'fortress') {
    for (const [fid, rid] of world.fortressRegions) if (rid === seed.id && !overrides.destroyedFortresses.has(fid)) return base;
    return 'contested';
  }
  return base === 'contested' && overrides.secured.has(seed.id) ? 'guarded' : base;
}

/** Context of a pirate spawn decision (§2.4, §6.1): the security overrides plus the calm-start rules. */
export interface SpawnContext extends SecurityOverrides {
  /** The Guild training is running. */
  training: boolean;
  /** Sector epoch (`sectorEpoch`); the depth-1 corner stays quiet in epoch 0. */
  epoch: number;
}

/**
 * The context of an untouched world after the calm start (no training, epoch ≥ 1, every fortress
 * standing, no sector secured): what contracts quote and what a hunt contract's group is built from,
 * so a contract's target never depends on the moment it is looked at.
 */
export const STATIC_SPAWN_CONTEXT: SpawnContext = { training: false, epoch: 1, ...NO_SECURITY_OVERRIDES };

/** The static part of a chunk's pirate profile (cached per world and chunk). */
interface ChunkSector {
  seed: RegionSeed;
  /** Distance of the chunk centre from home. */
  r: number;
  /** Corridor factor (0.2 inside a Guild Lane corridor, else 1). */
  corridor: number;
  corner1: boolean;
  /**
   * `chunkPirates` answers by the sector's security now – [awake, quiet] (quiet: the training or epoch 0,
   * only the depth-1 corner reads it). Pure in these, so shared (read-only).
   */
  pirates: Map<Security, [ChunkPirates | null, ChunkPirates | null]>;
}

const chunkSectors = new WeakMap<RegionWorld, Map<number, ChunkSector>>();

function chunkSector(world: RegionWorld, cx: number, cy: number): ChunkSector {
  let cache = chunkSectors.get(world);
  if (!cache) {
    cache = new Map();
    chunkSectors.set(world, cache);
  }
  const key = packedChunkKey(cx, cy);
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= REGION_GEN.chunkCache) cache.clear();
  const x = (cx + 0.5) * CHUNK_SIZE;
  const y = (cy + 0.5) * CHUNK_SIZE;
  const seed = world.field.regionOfChunk(cx, cy);
  const out: ChunkSector = {
    seed,
    r: hypot(x, y),
    corridor: laneDistance(world.lanes, x, y) <= REGION_GEN.lanes.corridor ? REGION_GEN.lanes.corridorPirates : 1,
    corner1: seed.id === world.corners.depth1,
    pirates: new Map(),
  };
  cache.set(key, out);
  return out;
}

/** Pirates of one chunk by the sector its centre lies in (§6.1). Multipliers come on top in the callers. */
export interface ChunkPirates {
  /** Depth of the chunk's sector (tier, hammer share). */
  depth: Depth;
  /** Security of the sector now. */
  security: Security;
  /** The depth-1 pirate corner (only T1 Jackals, own small rate). */
  corner: boolean;
  /** Pirate group chance per chunk at normal density (before local conditions and attention). */
  group: number;
  /** Share of groups led by a Hammer (attention may add to it where `hammerBonus`). */
  hammerShare: number;
  hammerBonus: boolean;
  /** Lone scavenger chance per chunk at normal density. */
  scavenger: number;
  /** Factor (0–1) of the scavenger chance at bigger wrecks. */
  wreckScavenger: number;
  tier: 1 | 2;
}

/**
 * The pirate profile of chunk (cx, cy): GROUP_RATE / HAMMER_SHARE / tier / scavenger chance read the
 * DEPTH of the sector of the chunk centre, then × the security multiplier and × 0.2 in a corridor.
 * Nothing within `pirateFreeRadius` of home, ever; the depth-1 corner has its own small rate of Jackal
 * groups and stays quiet during the Guild training and in epoch 0.
 */
export function chunkPirates(world: RegionWorld, cx: number, cy: number, ctx: SpawnContext): ChunkPirates {
  const c = chunkSector(world, cx, cy);
  const security = currentSecurity(world, c.seed, ctx);
  // memoised per chunk, security and quiet (the only inputs; perf audit 2026-10-17, P4)
  const quiet = ctx.training || ctx.epoch === 0 ? 1 : 0;
  let known = c.pirates.get(security);
  if (!known) {
    known = [null, null];
    c.pirates.set(security, known);
  }
  return (known[quiet] ??= piratesOf(c, security, ctx));
}

function piratesOf(c: ChunkSector, security: Security, ctx: SpawnContext): ChunkPirates {
  const depth = c.seed.depth;
  const tier: 1 | 2 = depth >= 4 ? 2 : 1;
  const none = { depth, security, corner: c.corner1, group: 0, hammerShare: 0, hammerBonus: false, scavenger: 0, wreckScavenger: 0, tier };
  if (c.r < REGION_GEN.corner.pirateFreeRadius) return none;
  if (c.corner1) return ctx.training || ctx.epoch === 0 ? none : { ...none, group: REGION_GEN.corner.depth1Rate * c.corridor };
  const m = depth === 1 ? 0 : REGION_GEN.groupMult[security] * c.corridor;
  if (m <= 0) return none;
  return {
    ...none,
    group: PIRATE_GROUPS.rate[depth] * m,
    hammerShare: PIRATE_GROUPS.hammerShare[depth],
    hammerBonus: true,
    scavenger: SCAVENGER.chunkChance[depth] * m,
    wreckScavenger: Math.min(1, m),
  };
}

/**
 * Pirate group chance per chunk at a world point (the chunk containing it):
 * GROUP_RATE[depth] × security multiplier × corridor 0.2; the depth-1 corner has its own small rate
 * (never during training or in epoch 0); nothing at all within `pirateFreeRadius` of home.
 */
export function pirateGroupRate(world: RegionWorld, x: number, y: number, ctx: SpawnContext): number {
  return chunkPirates(world, Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), ctx).group;
}

/**
 * A dangerous place for pirate attention, toll and hunting parties (§6.1, "inOuterBelts"): a
 * Contested or Pirate sector, or the depth-1 corner once it wakes up – never within
 * `pirateFreeRadius` of home.
 */
export function dangerousAt(world: RegionWorld, x: number, y: number, ctx: SpawnContext): boolean {
  if (hypot(x, y) < REGION_GEN.corner.pirateFreeRadius) return false;
  const seed = world.field.regionAt(x, y);
  if (seed.id === world.corners.depth1) return !ctx.training && ctx.epoch > 0;
  if (seed.depth === 1) return false;
  const security = currentSecurity(world, seed, ctx);
  return security === 'contested' || security === 'pirate';
}
