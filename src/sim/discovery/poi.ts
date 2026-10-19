// Points of interest (long-term design): deterministic from the seed per chunk, independent of the loading
// order (like stations). Only changes are saved (discovered, analysed, opened, broken shell).
// Forge-smith Echoes have fixed places derived from the seed.
import type { RingIndex } from '../../data/economy';
import { ECHOES, type EchoIndex } from '../../data/echoes';
import {
  ANOMALIES,
  ANOMALY_TYPES,
  GIANT_RADIUS,
  GIANT_RESOURCES,
  POI_CHUNK_MARGIN,
  POI_DENSITY,
  POI_HOME_CLEAR,
  POI_KINDS,
  POI_SPACING,
  POI_STATION_CLEAR,
  WRECK_CLASSES,
  WRECK_CLASS_WEIGHTS,
  type AnomalyType,
  type PoiKind,
  type WreckClass,
} from '../../data/poi';
import { RESOURCE_IDS, type ResourceId } from '../../data/resources';
import { TAU } from '../math/angle';
import { createRng, type Rng } from '../math/rng';
import { length, type Vec2 } from '../math/vec2';
import { CHUNK_SIZE, chunkCoord } from '../world/chunks';
import { generateChunk } from '../world/generate';
import { hash3 } from '../world/hash';
import { ringIndexAt } from '../world/rings';
import { ChunkMemo } from '../world/chunkMemo';
import { seedKey, stationAt, stationsInArea, type StationDef } from '../world/stations';

const POI_SALT = 0x9013_5a1d;
const ECHO_SALT = 0xec40_0e0f;

interface PoiBase {
  /** `<kind>:<cx>,<cy>` – at most one POI of a kind per chunk. */
  id: string;
  pos: Vec2;
  ring: RingIndex;
  cx: number;
  cy: number;
}

export interface WreckPoi extends PoiBase {
  kind: 'wreck';
  cls: WreckClass;
  /** 0 small, 1 medium, 2 large. */
  size: 0 | 1 | 2;
  angle: number;
}

export interface AnomalyPoi extends PoiBase {
  kind: 'anomaly';
  type: AnomalyType;
}

export interface CachePoi extends PoiBase {
  kind: 'cache';
}

export interface GiantPoi extends PoiBase {
  kind: 'giant';
  resource: ResourceId;
  /** 0..1 – model rotation. */
  variant: number;
}

export type Poi = WreckPoi | AnomalyPoi | CachePoi | GiantPoi;

/** Radius of a POI object (collisions, analysis target, label). */
export function poiRadius(p: Poi): number {
  switch (p.kind) {
    case 'wreck':
      return 3 + p.size * 1.5;
    case 'anomaly':
      return ANOMALIES[p.type].core;
    case 'cache':
      return 2;
    case 'giant':
      return GIANT_RADIUS;
  }
}

function pickWeighted<T extends string>(rng: Rng, keys: readonly T[], weight: (k: T) => number): T {
  let total = 0;
  for (const k of keys) total += weight(k);
  let r = rng() * total;
  for (const k of keys) {
    r -= weight(k);
    if (r < 0 && weight(k) > 0) return k;
  }
  return keys.filter((k) => weight(k) > 0).at(-1) ?? keys[0]!;
}

/** How far the centre of a POI must be from the chunk's asteroids (null = asteroids do not matter). */
const ROCK_CLEARANCE: Record<PoiKind, number | null> = { wreck: 6, anomaly: 18, cache: null, giant: GIANT_RADIUS + 5 };
const TRIES = 5;

const cache = new Map<string, Poi[]>();
const CACHE_MAX = 4096;
const memo = new ChunkMemo<Poi[]>(CACHE_MAX);

/** POIs in a chunk (0–4, in a fixed order of kinds). */
export function poisInChunk(seed: number, cx: number, cy: number): Poi[] {
  const key = seedKey(seed, 0, 1);
  if (key === null) {
    const k = `${seed},${cx},${cy}`;
    const hit = cache.get(k);
    if (hit) return hit;
    if (cache.size >= CACHE_MAX) cache.clear();
    const out = generate(seed, cx, cy);
    cache.set(k, out);
    return out;
  }
  // a number per chunk, not a string per lookup (poisNear asks for dozens of chunks every frame)
  return memo.get(key, cx, cy) ?? memo.set(key, cx, cy, generate(seed, cx, cy));
}

function generate(seed: number, cx: number, cy: number): Poi[] {
  const center = { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE };
  if (length(center) < POI_HOME_CLEAR) return [];
  const ring = ringIndexAt(length(center));
  const rng = createRng(hash3(hash3(seed ^ POI_SALT, cx, cy), 0, 0));
  const stations: StationDef[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const s = stationAt(seed, cx + dx, cy + dy);
    if (s) stations.push(s);
  }
  let rocks: { pos: Vec2; baseRadius: number }[] | null = null;
  const out: Poi[] = [];
  for (const kind of POI_KINDS) {
    // all random values are always rolled – the order does not depend on the outcome
    const roll = rng();
    const tries = Array.from({ length: TRIES }, () => ({
      x: cx * CHUNK_SIZE + POI_CHUNK_MARGIN + rng() * (CHUNK_SIZE - 2 * POI_CHUNK_MARGIN),
      y: cy * CHUNK_SIZE + POI_CHUNK_MARGIN + rng() * (CHUNK_SIZE - 2 * POI_CHUNK_MARGIN),
    }));
    const a = rng();
    const b = rng();
    const c = rng();
    if (roll >= POI_DENSITY[kind][ring]) continue;
    const clearance = ROCK_CLEARANCE[kind];
    if (clearance !== null && rocks === null) rocks = generateChunk(seed, cx, cy).asteroids;
    const pos = tries.find(
      (p) =>
        stations.every((s) => Math.hypot(p.x - s.pos.x, p.y - s.pos.y) >= s.clearRadius + POI_STATION_CLEAR) &&
        out.every((o) => Math.hypot(p.x - o.pos.x, p.y - o.pos.y) >= POI_SPACING) &&
        (clearance === null || rocks!.every((r) => Math.hypot(p.x - r.pos.x, p.y - r.pos.y) >= r.baseRadius + clearance)),
    );
    if (!pos) continue;
    const base = { id: `${kind}:${cx},${cy}`, pos, ring, cx, cy };
    switch (kind) {
      case 'wreck':
        out.push({ ...base, kind, cls: pickWeighted(rng0(a), WRECK_CLASSES, (k) => WRECK_CLASS_WEIGHTS[ring][k]), size: Math.min(2, Math.floor(b * 3)) as 0 | 1 | 2, angle: c * TAU });
        break;
      case 'anomaly':
        out.push({ ...base, kind, type: pickWeighted(rng0(a), ANOMALY_TYPES, (t) => ANOMALIES[t].weight) });
        break;
      case 'cache':
        out.push({ ...base, kind });
        break;
      case 'giant':
        out.push({ ...base, kind, resource: pickWeighted(rng0(a), RESOURCE_IDS, (r) => GIANT_RESOURCES[ring][r] ?? 0), variant: b });
        break;
    }
  }
  return out;
}

/** One rolled number as an "RNG" for pickWeighted. */
const rng0 = (x: number): Rng => () => x;

/** POIs within `radius` of a point (visits only the chunks the circle overlaps). */
export function poisNear(seed: number, pos: Vec2, radius: number): Poi[] {
  const out: Poi[] = [];
  const x0 = chunkCoord(pos.x - radius);
  const x1 = chunkCoord(pos.x + radius);
  const y0 = chunkCoord(pos.y - radius);
  const y1 = chunkCoord(pos.y + radius);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      for (const p of poisInChunk(seed, cx, cy)) if (Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y) <= radius) out.push(p);
    }
  }
  return out;
}

/** A POI by id (`kind:cx,cy`), or null. */
export function poiById(seed: number, id: string): Poi | null {
  const m = /^(wreck|anomaly|cache|giant):(-?\d+),(-?\d+)$/.exec(id);
  if (!m) return null;
  return poisInChunk(seed, Number(m[2]), Number(m[3])).find((p) => p.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Forge-smith Echoes

export interface EchoSite {
  index: EchoIndex;
  id: string;
  pos: Vec2;
  ring: RingIndex;
}

export const echoId = (index: EchoIndex): string => `echo:${index}`;
export const echoIndexOf = (id: string): EchoIndex | null => {
  const m = /^echo:([0-2])$/.exec(id);
  return m ? (Number(m[1]) as EchoIndex) : null;
};

const echoCache = new Map<number, EchoSite[]>();

/** Positions of Echoes 0–2: Echo-0 in a random direction from home, the others roughly the same direction outwards. */
export function echoSites(seed: number): EchoSite[] {
  const hit = echoCache.get(seed);
  if (hit) return hit;
  const rng = createRng(hash3(seed ^ ECHO_SALT, 0, 0));
  const base = rng() * TAU;
  const out: EchoSite[] = [];
  for (const def of ECHOES) {
    let angle = base + (rng() * 2 - 1) * def.spread;
    // the beacon must not stand next to a station – shift in small steps until there is room
    for (let i = 0; i < 24; i++) {
      const pos = { x: Math.cos(angle) * def.distance, y: Math.sin(angle) * def.distance };
      const c = { cx: chunkCoord(pos.x), cy: chunkCoord(pos.y) };
      const near = stationsInArea(seed, c.cx - 2, c.cx + 2, c.cy - 2, c.cy + 2).some((s) => Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) < s.clearRadius + 150);
      if (!near) break;
      angle += 0.07;
    }
    out.push({ index: def.index, id: echoId(def.index), pos: { x: Math.cos(angle) * def.distance, y: Math.sin(angle) * def.distance }, ring: def.ring });
  }
  if (echoCache.size > 64) echoCache.clear();
  echoCache.set(seed, out);
  return out;
}
