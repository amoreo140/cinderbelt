// Public sector API (stage 1a, the sectors design): one place where
// the simulation, the game layer, the map, HUD, sky, music and ambient ask "which sector is this and
// what is it like". Pure functions of (world seed, point / sector id, derived world state); nothing
// here is saved (stages 1a/1b change no save, §6.7). Code names stay "region"; players see "sector".
//
//   sectorIdAt(seed, x, y)          → sector id at a world point
//   sectorInfoAt(seed, x, y)        → SectorInfo at a world point
//   sectorInfo(seed, id)            → SectorInfo of a sector id (any depth, also the infinite depth 4+)
//   sectorSecurity(seed, id, overrides) → security now (destroyed fortresses, Guild-secured sectors)
//   sectorThreat(info, security)    → threat word of the map card / HUD (§3.1)
//   isDangerousSecurity(security)   → Contested or Pirate: pirate attention, toll, hunting parties (§6.1)
//   guildCorridorAt(seed, x, y)     → inside a Guild Lane corridor (±250 u, §2.3)
//   sectorLanes(seed)               → the Guild Lane lines (map, buoys)
//
// Names (§2.7) are indexes only; the words live in src/i18n/. Biomes (§0, §3.2) are look + name only.
import type { Vec2 } from '../math/vec2';
import { REGION_GEN, type Depth, type Knowledge, type Security } from './constants';
import type { RegionSeed } from './field';
import { inCorridor, type GuildLane } from './lanes';
import { regionHash, rollSecurity } from './security';
import { currentSecurity, NO_SECURITY_OVERRIDES, regionWorld, type FixedReason, type RegionWorld, type SecurityOverrides } from './world';

/** Environment of a sector (§0, §3.2) – look and name only in stages 1a–2; no word "belt". */
export type Biome =
  // depth 1
  | 'asteroidField'
  | 'iceField'
  | 'quietSpace'
  // depth 2
  | 'rustField'
  | 'ionFringe'
  | 'wreckField'
  | 'titanPlateau'
  // depth 3
  | 'crystalNebula'
  | 'cometPath'
  // depth 4+ (no player-facing set in the design yet)
  | 'deepDark';

/** Biomes a sector of a depth draws from (by hash of its id). */
export const BIOMES_BY_DEPTH: Readonly<Record<Depth, readonly Biome[]>> = {
  1: ['asteroidField', 'iceField', 'quietSpace'],
  2: ['rustField', 'ionFringe', 'wreckField', 'titanPlateau'],
  3: ['crystalNebula', 'cometPath'],
  4: ['deepDark'],
};

/** Sizes of the generated name word lists (§2.7: 12 adjectives × 12 nouns, both languages in src/i18n/). */
export const SECTOR_NAME_WORDS = { adjectives: 12, nouns: 12 } as const;

/**
 * Name key of a sector (§2.7). Hand-made names first (Origin, fortress sectors, the two pirate corners,
 * sectors with a landmark), the rest generated: adjective × noun, unique among the finite sectors
 * (depth 1–3) in id order; `numeral` (II, III …) only when the 144 pairs run out, 0 = none.
 * Depth 4+ sectors are unbounded: their pair comes from the hash and may repeat far apart.
 */
export type SectorName =
  | { kind: 'origin' }
  | { kind: 'fortress'; fortress: string }
  | { kind: 'corner'; corner: 1 | 2 }
  | { kind: 'landmark'; landmark: string; landmarkKind: string }
  | { kind: 'generated'; adjective: number; noun: number; numeral: number };

/** Threat word of a sector (§3.1): none / rare / often / nest. */
export type Threat = 'none' | 'rare' | 'often' | 'nest';

export interface SectorInfo {
  id: string;
  depth: Depth;
  /** Security of an untouched world (seed only). For the current one use `sectorSecurity`. */
  security: Security;
  /** Why the security is fixed (§2.4), or null for a rolled sector. */
  fixed: FixedReason | null;
  /** Pirate corner 1 (depth 1) or 2 (depth 2), else null. */
  corner: 1 | 2 | null;
  origin: boolean;
  biome: Biome;
  name: SectorName;
  /** Knowledge at the start of a game (§3.3, derived from the seed). Stage 1b adds coverage. */
  startKnowledge: Knowledge;
  /** The sector's seed point – the label anchor of the map. */
  anchor: Vec2;
  /** A Guild Lane runs through the sector (≥ `lanes.laneMin` of its line). */
  onLane: boolean;
  /** Landmark ids anchored in the sector (`landmarkSites`). */
  landmarks: readonly string[];
}

interface SectorTable {
  world: RegionWorld;
  infos: Map<string, SectorInfo>;
}

const tables = new WeakMap<RegionWorld, SectorTable>();

const pickBiome = (seed: number, id: string, depth: Depth): Biome => {
  const list = BIOMES_BY_DEPTH[depth];
  return list[Math.min(list.length - 1, Math.floor(regionHash(seed, id, 3) * list.length))]!;
};

const pairOf = (seed: number, id: string): { adjective: number; noun: number } => ({
  adjective: Math.floor(regionHash(seed, id, 4) * SECTOR_NAME_WORDS.adjectives),
  noun: Math.floor(regionHash(seed, id, 5) * SECTOR_NAME_WORDS.nouns),
});

function buildTable(world: RegionWorld): SectorTable {
  const infos = new Map<string, SectorInfo>();
  const pairs = SECTOR_NAME_WORDS.adjectives * SECTOR_NAME_WORDS.nouns;
  const used = new Map<number, number>();
  const fortressOf = new Map<string, string>();
  for (const [fid, rid] of world.fortressRegions) if (!fortressOf.has(rid) || fid < fortressOf.get(rid)!) fortressOf.set(rid, fid);
  const kindOf = new Map(world.inputs.landmarks.map((l) => [l.id, l.kind]));
  // world.regions is sorted by key: names are assigned in that order (stable for a seed)
  for (const r of world.regions) {
    const id = r.seed.id;
    const corner: 1 | 2 | null = id === world.corners.depth1 ? 1 : id === world.corners.depth2 ? 2 : null;
    let name: SectorName;
    const landmark = [...r.landmarks].sort()[0];
    if (r.seed.origin) name = { kind: 'origin' };
    else if (fortressOf.has(id)) name = { kind: 'fortress', fortress: fortressOf.get(id)! };
    else if (corner !== null) name = { kind: 'corner', corner };
    else if (landmark !== undefined) name = { kind: 'landmark', landmark, landmarkKind: kindOf.get(landmark) ?? '' };
    else {
      // first free pair from the hashed one, walking the 144 pairs in order; the round counts numerals
      const p = pairOf(world.seed, id);
      const start = p.adjective * SECTOR_NAME_WORDS.nouns + p.noun;
      let best = start;
      let round = Infinity;
      for (let k = 0; k < pairs; k++) {
        const idx = (start + k) % pairs;
        const n = used.get(idx) ?? 0;
        if (n < round) {
          round = n;
          best = idx;
          if (n === 0) break;
        }
      }
      used.set(best, round + 1);
      name = { kind: 'generated', adjective: Math.floor(best / SECTOR_NAME_WORDS.nouns), noun: best % SECTOR_NAME_WORDS.nouns, numeral: round };
    }
    infos.set(id, {
      id,
      depth: r.seed.depth,
      security: r.security,
      fixed: r.fixed,
      corner,
      origin: r.seed.origin,
      biome: r.fixed === 'fortress' ? 'rustField' : pickBiome(world.seed, id, r.seed.depth),
      name,
      startKnowledge: world.startKnowledge.get(id) ?? 'uncharted',
      anchor: { x: r.seed.x, y: r.seed.y },
      onLane: r.onLane,
      landmarks: r.landmarks,
    });
  }
  return { world, infos };
}

function table(seed: number): SectorTable {
  const world = regionWorld(seed);
  let t = tables.get(world);
  if (!t) {
    t = buildTable(world);
    tables.set(world, t);
  }
  return t;
}

/** A sector outside the rastered world (depth 4+, or beyond `balance.rasterRadius`): rolled only. */
function outerInfo(world: RegionWorld, s: RegionSeed): SectorInfo {
  return {
    id: s.id,
    depth: s.depth,
    security: rollSecurity(world.seed, s.id, s.depth),
    fixed: null,
    corner: null,
    origin: s.origin,
    biome: pickBiome(world.seed, s.id, s.depth),
    name: { kind: 'generated', ...pairOf(world.seed, s.id), numeral: 0 },
    startKnowledge: 'uncharted',
    anchor: { x: s.x, y: s.y },
    onLane: false,
    landmarks: [],
  };
}

const outerCache = new Map<string, SectorInfo>();

function infoOfSeed(seed: number, s: RegionSeed): SectorInfo {
  const t = table(seed);
  const hit = t.infos.get(s.id);
  if (hit) return hit;
  const key = `${seed}|${s.id}`;
  let info = outerCache.get(key);
  if (!info) {
    if (outerCache.size >= 2048) outerCache.clear();
    info = outerInfo(t.world, s);
    outerCache.set(key, info);
  }
  return info;
}

/** Id of the sector at a world point. */
export const sectorIdAt = (seed: number, x: number, y: number): string => regionWorld(seed).field.regionAt(x, y).id;

/** The sector at a world point. */
export const sectorInfoAt = (seed: number, x: number, y: number): SectorInfo => infoOfSeed(seed, regionWorld(seed).field.regionAt(x, y));

/** The sector of chunk (cx, cy) – its centre decides (LRU-cached; spawns, coverage). */
export const sectorInfoOfChunk = (seed: number, cx: number, cy: number): SectorInfo =>
  infoOfSeed(seed, regionWorld(seed).field.regionOfChunk(cx, cy));

/** The sector with this id, or null when the id is not a sector of this seed. */
export function sectorInfo(seed: number, id: string): SectorInfo | null {
  // a rastered sector by its own id: the table answers without parsing the id (the map asks every
  // sector every frame – perf audit 2026-10-17, P4); the same object `infoOfSeed` returns
  const known = table(seed).infos.get(id);
  if (known) return known;
  const s = regionWorld(seed).field.seedById(id);
  return s ? infoOfSeed(seed, s) : null;
}

/**
 * Security now (§2.4, §3.1; M4d §2.1): the static security with the overrides of the game – a fortress
 * sector whose fortresses are all destroyed is Contested, a Contested sector secured by a Guild relay
 * is Guarded (`securityOverrides(state)`; derived – no new state).
 */
export function sectorSecurity(seed: number, id: string, overrides: SecurityOverrides = NO_SECURITY_OVERRIDES): Security {
  const world = regionWorld(seed);
  const s = world.field.seedById(id);
  return s ? currentSecurity(world, s, overrides) : 'contested';
}

/** Contested and Pirate sectors are dangerous: pirate attention, toll and hunting parties (§6.1). */
export const isDangerousSecurity = (security: Security): boolean => security === 'contested' || security === 'pirate';

/**
 * Threat word of a sector (§3.1), from the expected group density so colour and risk agree:
 * nothing → none, below the depth-2 Contested density → rare, up to ×1.0 → often, above → nest.
 * The depth-1 corner is a nest (its own small rate, but it is the red spot near home).
 */
export function sectorThreat(info: Pick<SectorInfo, 'depth' | 'corner'>, security: Security): Threat {
  if (info.corner === 1) return 'nest';
  const m = info.depth === 1 ? 0 : REGION_GEN.groupMult[security];
  if (m <= 0) return 'none';
  if (m < 1) return 'rare';
  return m > 1 ? 'nest' : 'often';
}

/** Inside a Guild Lane corridor (±250 u)? */
export const guildCorridorAt = (seed: number, x: number, y: number): boolean => inCorridor(regionWorld(seed).lanes, x, y);

/** The Guild Lanes of a seed (lines bent around fortresses; map and buoys). */
export const sectorLanes = (seed: number): readonly GuildLane[] => regionWorld(seed).lanes;
