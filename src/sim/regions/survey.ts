// Survey points (sectors design §4.1, stage 2): the fast way to chart a sector – "fly to the point →
// scanner pulse → discover what lies near it". A pure function of the seed and the sector id (part of
// the frozen generator, REGION_GEN.survey), cached per sector.
//
//   surveyPoints(seed, id)            → the sector's points (3 / 4 / 5 by depth; none in start-Charted
//                                       sectors and at depth 4+)
//   surveyMask(seed, id)              → the bit mask of all its points
//   surveyPointsNear(seed, pos, r)    → points of every sector within r of a position (the pulse)
//
// Placement: candidates are the sector's landmarks, then its POIs (wrecks, anomalies, giants – never a
// cache, the map must not reveal one, §3.3), then asteroid cluster centres, then the chunk centres as
// a last resort; inside each group the order comes from a hash. Greedy, in that order: a candidate is
// taken when it lies at least `margin` inside the border (sampled on `borderRays` rays) and `spacing`
// from the points taken so far; small sectors relax margin and spacing step by step (`relax`).
import { poisInChunk } from '../discovery/poi';
import type { Vec2 } from '../math/vec2';
import { CHUNK_SIZE } from '../world/chunks';
import { chunkClusters } from '../world/generate';
import { hash3 } from '../world/hash';
import { REGION_GEN } from './constants';
import { sectorChunkKeys } from './chunks';
import { sectorInfo } from './sectors';
import { regionWorld } from './world';

/** What a survey point sits at (the map and the HUD may show it; never a cache). */
export type SurveyAnchor = 'landmark' | 'poi' | 'cluster' | 'open';

export interface SurveyPoint {
  /** Index in the sector's list = its bit in `RegionsState.points`. */
  index: number;
  sector: string;
  pos: Vec2;
  anchor: SurveyAnchor;
}

const SURVEY_SALT = 0x5a7e_c0de;
const ANCHOR_ORDER: readonly SurveyAnchor[] = ['landmark', 'poi', 'cluster', 'open'];

interface Candidate {
  pos: Vec2;
  anchor: SurveyAnchor;
  order: number;
}

const CACHE_MAX = 4096;
/** Survey points by seed, then sector id (no key string per call; the last seed first). */
const pointsBySeed = new Map<number, Map<string, readonly SurveyPoint[]>>();
let lastSeed = NaN;
let lastCache: Map<string, readonly SurveyPoint[]> | null = null;

function seedCache(seed: number): Map<string, readonly SurveyPoint[]> {
  if (seed === lastSeed && lastCache) return lastCache;
  let c = pointsBySeed.get(seed);
  if (!c) {
    if (pointsBySeed.size >= 8) pointsBySeed.clear();
    c = new Map();
    pointsBySeed.set(seed, c);
  }
  lastSeed = seed;
  lastCache = c;
  return c;
}

/** Points needed to chart a sector of this depth by survey (0 = none). */
export const surveyPointCount = (depth: number): number => REGION_GEN.survey.points[Math.min(4, Math.max(1, depth)) as 1 | 2 | 3 | 4];

function candidates(seed: number, id: string): Candidate[] {
  const world = regionWorld(seed);
  const field = world.field;
  const inside = (p: Vec2): boolean => field.regionAt(p.x, p.y).id === id;
  const order = (p: Vec2, k: number): number => hash3(seed ^ SURVEY_SALT, Math.round(p.x) * 4 + k, Math.round(p.y));
  const out: Candidate[] = [];
  for (const l of world.inputs.landmarks) if (world.landmarkRegions.get(l.id) === id) out.push({ pos: { ...l.pos }, anchor: 'landmark', order: order(l.pos, 0) });
  for (const key of sectorChunkKeys(seed, id)) {
    const comma = key.indexOf(',');
    const cx = Number(key.slice(0, comma));
    const cy = Number(key.slice(comma + 1));
    for (const poi of poisInChunk(seed, cx, cy)) {
      if (poi.kind === 'cache' || !inside(poi.pos)) continue;
      out.push({ pos: { ...poi.pos }, anchor: 'poi', order: order(poi.pos, 1) });
    }
    for (const c of chunkClusters(seed, cx, cy)) if (inside(c.center)) out.push({ pos: { ...c.center }, anchor: 'cluster', order: order(c.center, 2) });
    const centre = { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE };
    out.push({ pos: centre, anchor: 'open', order: order(centre, 3) });
  }
  return out.sort(
    (a, b) => ANCHOR_ORDER.indexOf(a.anchor) - ANCHOR_ORDER.indexOf(b.anchor) || a.order - b.order || a.pos.x - b.pos.x || a.pos.y - b.pos.y,
  );
}

/** Is the point at least `margin` inside sector `id` (sampled on rays at margin and margin / 2)? */
function deepInside(seed: number, id: string, p: Vec2, margin: number): boolean {
  const field = regionWorld(seed).field;
  if (field.regionAt(p.x, p.y).id !== id) return false;
  if (margin <= 0) return true;
  const n = REGION_GEN.survey.borderRays;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const r of [margin, margin / 2]) if (field.regionAt(p.x + c * r, p.y + s * r).id !== id) return false;
  }
  return true;
}

function place(seed: number, id: string, count: number): SurveyPoint[] {
  const list = candidates(seed, id);
  const picked: Candidate[] = [];
  for (const [margin, spacing] of REGION_GEN.survey.relax) {
    for (const c of list) {
      if (picked.length >= count) break;
      if (picked.includes(c)) continue;
      if (picked.some((p) => Math.hypot(p.pos.x - c.pos.x, p.pos.y - c.pos.y) < spacing)) continue;
      if (deepInside(seed, id, c.pos, margin)) picked.push(c);
    }
    if (picked.length >= count) break;
  }
  return picked.map((c, index) => ({ index, sector: id, pos: c.pos, anchor: c.anchor }));
}

/**
 * The survey points of a sector, in index order (empty for an unknown id, depth 4+ and the
 * start-Charted sectors – Origin and lane A's first sector, which the Guild charts for the player).
 */
export function surveyPoints(seed: number, id: string): readonly SurveyPoint[] {
  const cache = seedCache(seed);
  const hit = cache.get(id);
  if (hit) return hit;
  const info = sectorInfo(seed, id);
  const count = info && info.startKnowledge !== 'charted' && regionWorld(seed).info(id) ? surveyPointCount(info.depth) : 0;
  const points = count > 0 ? place(seed, id, count) : [];
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(id, points);
  return points;
}

/** Bit mask of all survey points of a sector (0 when it has none). */
export const surveyMask = (seed: number, id: string): number => (1 << surveyPoints(seed, id).length) - 1;

/** Survey points of every sector within `radius` of `pos` (sectors sampled at the centre and on 8 rays). */
export function surveyPointsNear(seed: number, pos: Vec2, radius: number): SurveyPoint[] {
  const field = regionWorld(seed).field;
  const ids = new Set<string>([field.regionAt(pos.x, pos.y).id]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ids.add(field.regionAt(pos.x + Math.cos(a) * radius, pos.y + Math.sin(a) * radius).id);
  }
  const out: SurveyPoint[] = [];
  for (const id of [...ids].sort()) {
    for (const p of surveyPoints(seed, id)) if (Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y) <= radius) out.push(p);
  }
  return out;
}
