// Asteroid fields on the map (10.8 "my trail"): clusters of asteroids are derived from the explored chunks
// by the prevailing resource (coarse, one circle per cluster). Mined-out fields are faded.
import type { ResourceId } from '../../data/resources';
import { generateChunk } from '../../sim/world/generate';
import type { MapField } from '../../ui/discovery/MapView';
import { parseChunkKey } from '../../ui/map';
import { oreGrade } from '../../sim/mining/grade';

interface Cluster {
  pos: { x: number; y: number };
  radius: number;
  resource: ResourceId;
  ids: string[];
}

const cache = new Map<string, Cluster[]>();
const CACHE_MAX = 6000;
/** Asteroids closer than this belong to one cluster (u). */
const LINK = 45;

/** The asteroid clusters of a chunk (deterministic from the seed, cached). */
export function chunkClusters(seed: number, key: string): Cluster[] {
  const k = `${seed}:${key}`;
  const hit = cache.get(k);
  if (hit) return hit;
  if (cache.size > CACHE_MAX) cache.clear();
  const { cx, cy } = parseChunkKey(key);
  const rocks = generateChunk(seed, cx, cy).asteroids;
  const groups: (typeof rocks)[] = [];
  for (const a of rocks) {
    const g = groups.find((list) => list.some((b) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < LINK));
    if (g) g.push(a);
    else groups.push([a]);
  }
  const out: Cluster[] = [];
  for (const g of groups) {
    if (g.length < 3) continue;
    const x = g.reduce((s, a) => s + a.pos.x, 0) / g.length;
    const y = g.reduce((s, a) => s + a.pos.y, 0) / g.length;
    const radius = Math.max(...g.map((a) => Math.hypot(a.pos.x - x, a.pos.y - y) + a.baseRadius));
    const counts = new Map<ResourceId, number>();
    for (const a of g) counts.set(a.resource, (counts.get(a.resource) ?? 0) + a.initialAmount);
    const resource = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    out.push({ pos: { x, y }, radius, resource, ids: g.map((a) => a.id) });
  }
  cache.set(k, out);
  return out;
}

/**
 * Fields of the explored chunks; `remaining(id)` = what is left of a mined rock (undefined = untouched).
 * `assayed` = chunks whose grades the scanner revealed (Mining 2.0): their fields carry the best grade
 * of a rock not yet mined out.
 */
export function asteroidFields(
  seed: number,
  explored: Iterable<string>,
  remaining: (id: string) => number | undefined,
  assayed: ReadonlySet<string> = new Set(),
): MapField[] {
  const out: MapField[] = [];
  for (const key of explored) {
    for (const c of chunkClusters(seed, key)) {
      const depleted = c.ids.every((id) => remaining(id) === 0);
      const field: MapField = { pos: c.pos, radius: c.radius, resource: c.resource, depleted };
      if (assayed.has(key)) {
        let best = 0;
        for (const id of c.ids) if (remaining(id) !== 0) best = Math.max(best, oreGrade(seed, { id, pos: c.pos }));
        if (best > 0) field.grade = best;
      }
      out.push(field);
    }
  }
  return out;
}
