// The region field (§2.2, §6.8): which sector a world point belongs to.
//   regionAt(x, y): warp the point into q-space, then the power diagram min(d² − w) over the
//   candidate seeds of its q-space tile (tie → smaller key). Candidate lists are cached per tile and
//   pruned with an exact power bound, so ~5–15 seeds are compared per call.
//   regionOfChunk(cx, cy): the sector of the chunk centre, LRU-cached (spawns, coverage).
import { hypot } from '../math/vec2';
import { packedChunkKey } from '../world/chunkMemo';
import { CHUNK_SIZE } from '../world/chunks';
import { REGION_GEN, type RegionVariant } from './constants';
import { createSeedSource, type RegionSeed, type SeedSource } from './seeds';
import { warpAmplitude, warpPoint } from './warp';

export type { RegionSeed } from './seeds';

/** Candidate seeds of one q-space tile. */
interface Tile {
  seeds: RegionSeed[];
}

export interface RegionField {
  readonly seed: number;
  readonly variant: RegionVariant;
  readonly source: SeedSource;
  readonly origin: RegionSeed;
  /** The sector of world point (x, y). */
  regionAt(x: number, y: number): RegionSeed;
  /** The sector of the centre of chunk (cx, cy) (cached). */
  regionOfChunk(cx: number, cy: number): RegionSeed;
  /** World → q-space (the warped point the power diagram sees). */
  warp(x: number, y: number, out: { x: number; y: number }): void;
  /** The cell owner of a q-space point (no warp). */
  ownerAtQ(qx: number, qy: number): RegionSeed;
  /** Candidate seeds that can own some point of the q-space tile containing (qx, qy). */
  candidatesAtQ(qx: number, qy: number): readonly RegionSeed[];
  seedById(id: string): RegionSeed | null;
}

/** Power distance of q-space point to a seed. */
export const powerDistance = (s: RegionSeed, qx: number, qy: number): number => {
  const dx = qx - s.x;
  const dy = qy - s.y;
  return dx * dx + dy * dy - s.weight;
};

/**
 * Map key of a tile / chunk: a small integer (a V8 Smi – no boxing per lookup, perf audit 2026-10-17 P4)
 * for the near ones, the old wide key shifted past every small key for the rest.
 */
const tileKey = packedChunkKey;

/** `regionAt` answers remembered by exact point (a small ring). */
const RECENT = 8;

class Field implements RegionField {
  readonly source: SeedSource;
  readonly origin: RegionSeed;
  private readonly tiles = new Map<number, Tile>();
  private readonly chunks = new Map<number, RegionSeed>();
  private readonly q = { x: 0, y: 0 };
  /**
   * The last few `regionAt` answers by exact point: a step asks for the ship's own sector many times
   * (sector state, storms, radar, spawns …) – no warp noise per repeat (perf audit 2026-10-17, P4). Pure.
   */
  private readonly lastX = new Float64Array(RECENT);
  private readonly lastY = new Float64Array(RECENT);
  private readonly lastSeed: (RegionSeed | null)[] = new Array<RegionSeed | null>(RECENT).fill(null);
  private lastNext = 0;

  constructor(
    readonly seed: number,
    readonly variant: RegionVariant,
  ) {
    this.source = createSeedSource(seed, variant);
    this.origin = this.source.origin;
  }

  warp(x: number, y: number, out: { x: number; y: number }): void {
    const r = hypot(x, y);
    warpPoint(this.seed, x, y, warpAmplitude(r, this.source.minDistanceAt(r)), out);
  }

  private tile(tx: number, ty: number): Tile {
    const key = tileKey(tx, ty);
    const hit = this.tiles.get(key);
    if (hit) return hit;
    const T = REGION_GEN.tile;
    const x0 = tx * T;
    const y0 = ty * T;
    const x1 = x0 + T;
    const y1 = y0 + T;
    const rMax = Math.max(hypot(x0, y0), hypot(x1, y0), hypot(x0, y1), hypot(x1, y1));
    let margin = 1.6 * this.source.spacingAt(rMax);
    let seeds: RegionSeed[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const gathered = this.source.seedsInBox(x0 - margin, y0 - margin, x1 + margin, y1 + margin);
      // U: an upper bound of the owner's power distance anywhere in the tile
      let upper = Infinity;
      for (const s of gathered) upper = Math.min(upper, maxDist2(s, x0, y0, x1, y1) - s.weight);
      // a seed outside the gathered box is ≥ margin away from the tile: it cannot win when margin² − wMax > U
      const sMax = this.source.spacingAt(rMax + margin * 2);
      const wMax = REGION_GEN.weight * sMax * sMax;
      if (gathered.length > 0 && margin * margin - wMax > upper) {
        seeds = gathered.filter((s) => minDist2(s, x0, y0, x1, y1) - s.weight <= upper);
        break;
      }
      margin *= 1.6;
    }
    seeds.sort((a, b) => a.key - b.key);
    const t = { seeds };
    if (this.tiles.size > 40_000) this.tiles.clear();
    this.tiles.set(key, t);
    return t;
  }

  candidatesAtQ(qx: number, qy: number): readonly RegionSeed[] {
    const T = REGION_GEN.tile;
    return this.tile(Math.floor(qx / T), Math.floor(qy / T)).seeds;
  }

  ownerAtQ(qx: number, qy: number): RegionSeed {
    const seeds = this.candidatesAtQ(qx, qy);
    let best = seeds[0]!;
    let bestP = powerDistance(best, qx, qy);
    for (let i = 1; i < seeds.length; i++) {
      const s = seeds[i]!;
      const p = powerDistance(s, qx, qy);
      // seeds are sorted by key, so a strict < keeps the smaller key on a tie
      if (p < bestP) {
        best = s;
        bestP = p;
      }
    }
    return best;
  }

  regionAt(x: number, y: number): RegionSeed {
    for (let i = 0; i < RECENT; i++) {
      const s = this.lastSeed[i];
      if (s && this.lastX[i] === x && this.lastY[i] === y) return s;
    }
    this.warp(x, y, this.q);
    const owner = this.ownerAtQ(this.q.x, this.q.y);
    const k = this.lastNext;
    this.lastX[k] = x;
    this.lastY[k] = y;
    this.lastSeed[k] = owner;
    this.lastNext = (k + 1) % RECENT;
    return owner;
  }

  regionOfChunk(cx: number, cy: number): RegionSeed {
    const key = tileKey(cx, cy);
    const hit = this.chunks.get(key);
    if (hit) {
      // LRU: move to the newest end
      this.chunks.delete(key);
      this.chunks.set(key, hit);
      return hit;
    }
    const r = this.regionAt((cx + 0.5) * CHUNK_SIZE, (cy + 0.5) * CHUNK_SIZE);
    if (this.chunks.size >= REGION_GEN.chunkCache) this.chunks.delete(this.chunks.keys().next().value!);
    this.chunks.set(key, r);
    return r;
  }

  seedById(id: string): RegionSeed | null {
    return this.source.seedById(id);
  }
}

function minDist2(s: RegionSeed, x0: number, y0: number, x1: number, y1: number): number {
  const dx = s.x < x0 ? x0 - s.x : s.x > x1 ? s.x - x1 : 0;
  const dy = s.y < y0 ? y0 - s.y : s.y > y1 ? s.y - y1 : 0;
  return dx * dx + dy * dy;
}

function maxDist2(s: RegionSeed, x0: number, y0: number, x1: number, y1: number): number {
  const dx = Math.max(Math.abs(s.x - x0), Math.abs(s.x - x1));
  const dy = Math.max(Math.abs(s.y - y0), Math.abs(s.y - y1));
  return dx * dx + dy * dy;
}

const fields = new Map<string, RegionField>();
/** The last answer of `regionField` (no key string per call for the game's own seed). */
let lastField: RegionField | null = null;

/** The region field of a world seed and variant (cached; pure and deterministic). */
export function regionField(seed: number, variant: RegionVariant = REGION_GEN.variant): RegionField {
  if (lastField !== null && lastField.seed === seed && lastField.variant === variant) return lastField;
  lastField = regionFieldOf(seed, variant);
  return lastField;
}

function regionFieldOf(seed: number, variant: RegionVariant): RegionField {
  const key = `${seed}:${variant}`;
  const hit = fields.get(key);
  if (hit) return hit;
  const f = new Field(seed, variant);
  if (fields.size >= 8) fields.clear();
  fields.set(key, f);
  return f;
}

/** A field that shares no cache with others (benchmarks: cold-cache numbers). */
export const freshRegionField = (seed: number, variant: RegionVariant = REGION_GEN.variant): RegionField => new Field(seed, variant);

/** The sector of world point (x, y) for this seed (variant = REGION_GEN.variant unless given). */
export const regionAt = (seed: number, x: number, y: number, variant: RegionVariant = REGION_GEN.variant): RegionSeed =>
  regionField(seed, variant).regionAt(x, y);
