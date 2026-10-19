// The chunks of a sector (chunk centre inside it) – shared by the knowledge (coverage) and the survey
// points. Pure function of the seed and the sector id, cached.
import { CHUNK_SIZE, chunkKey } from '../world/chunks';
import type { RegionField, RegionSeed } from './field';
import { regionWorld } from './world';

const CHUNK_KEYS_MAX = 4096;
/**
 * The keys of a seed's sectors by sector id. Per seed, no key string per call (the map asks every
 * sector every frame – perf audit 2026-10-17, P4); the last seed is looked up first.
 */
const chunkKeysBySeed = new Map<number, Map<string, readonly string[]>>();
let lastSeed = NaN;
let lastKeys: Map<string, readonly string[]> | null = null;

/**
 * Chunks of a sector: square rings of chunks around the seed's chunk until a ring beyond the
 * minimum reach holds none of the sector's chunks. Cells are convex power cells warped by ≤ 110 u,
 * so the chunk set is compact around the seed (the test checks the margin over many seeds).
 */
function scanChunks(field: RegionField, s: RegionSeed): string[] {
  const out: string[] = [];
  const ccx = Math.floor(s.x / CHUNK_SIZE);
  const ccy = Math.floor(s.y / CHUNK_SIZE);
  const minReach = Math.ceil((0.6 * s.spacing) / CHUNK_SIZE) + 1;
  const maxReach = Math.ceil((3 * s.spacing) / CHUNK_SIZE) + 2;
  const test = (cx: number, cy: number): boolean => {
    if (field.regionAt((cx + 0.5) * CHUNK_SIZE, (cy + 0.5) * CHUNK_SIZE).id !== s.id) return false;
    // the shared "cx,cy" string of the chunk (`chunkKey` memoises them: a rescan makes no new strings)
    out.push(chunkKey(cx, cy));
    return true;
  };
  test(ccx, ccy);
  for (let k = 1; k <= maxReach; k++) {
    let hits = 0;
    for (let d = -k; d <= k; d++) {
      if (test(ccx + d, ccy - k)) hits++;
      if (test(ccx + d, ccy + k)) hits++;
    }
    for (let d = -k + 1; d <= k - 1; d++) {
      if (test(ccx - k, ccy + d)) hits++;
      if (test(ccx + k, ccy + d)) hits++;
    }
    if (hits === 0 && k >= minReach) break;
  }
  return out.sort();
}

/** The chunk keys ("cx,cy") of a sector – chunk centre inside it (sorted; cached). Empty for an unknown id. */
export function sectorChunkKeys(seed: number, id: string): readonly string[] {
  let cache = seed === lastSeed ? lastKeys : null;
  if (!cache) {
    cache = chunkKeysBySeed.get(seed) ?? null;
    if (!cache) {
      if (chunkKeysBySeed.size >= 8) chunkKeysBySeed.clear();
      cache = new Map();
      chunkKeysBySeed.set(seed, cache);
    }
    lastSeed = seed;
    lastKeys = cache;
  }
  const hit = cache.get(id);
  if (hit) return hit;
  const field = regionWorld(seed).field;
  const s = field.seedById(id);
  const keys = s ? scanChunks(field, s) : [];
  if (cache.size >= CHUNK_KEYS_MAX) cache.clear();
  cache.set(id, keys);
  return keys;
}
