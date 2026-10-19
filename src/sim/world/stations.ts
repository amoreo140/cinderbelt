// Station generation (spec M2, ch. 8): deterministic from the seed, only from the chunk hash,
// independent of the loading order – a station can be found outside the active chunks too.
// The model (and with it the collision circles) also depends on the world generation (worldGen.ts):
// pass the game's `world.gen` wherever the model or the colliders matter.
import { PRICE_JITTER_MAX, PRICE_JITTER_MIN, type RingIndex } from '../../data/economy';
import { RESOURCE_IDS, type ResourceId } from '../../data/resources';
import {
  STATION_LAYOUTS,
  STATION_SERVICES,
  stationModelFor,
  stationModelForRing,
  type StationKind,
  type StationModel,
  type StationServices,
} from '../../data/stations';
import { TAU } from '../math/angle';
import { createRng } from '../math/rng';
import { length, type Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import { CHUNK_SIZE, chunkCoord } from './chunks';
import { hash3 } from './hash';
import { RINGS, ringIndexAt } from './rings';
import { WORLD_GEN_LEGACY, type WorldGen } from './worldGen';
import { ChunkMemo } from './chunkMemo';

export type StationId = string;

/** The name as indices into the lists in sk.ts (the simulation knows no texts). */
export interface StationName {
  prefix: number;
  star: number;
  /** null = no number (the guaranteed stations and home). */
  number: number | null;
}

export interface StationDef {
  id: StationId;
  kind: StationKind;
  name: StationName;
  pos: Vec2;
  ring: RingIndex;
  chunk: { cx: number; cy: number };
  model: StationModel;
  /** Radius of the bounding circle (docking). */
  radius: number;
  /** No asteroids around the station (an asteroid's centre farther than clearRadius + its radius). */
  clearRadius: number;
  /** Collision circles in the station's local frame (+x = port direction). */
  colliders: Circle[];
  /** Port direction (angle) – where ships dock from and depart to. */
  portAngle: number;
  services: StationServices;
  /** Local deviation of resource prices, 0.95–1.05. */
  priceJitter: Record<ResourceId, number>;
  /** 0..1 – picks the model variant. */
  variant: number;
}

export const HOME_STATION_ID: StationId = 'home';
/** Clear circle around the home station (spec M2, ch. 1). */
export const HOME_CLEAR_RADIUS = 45;
/** No random station closer to the origin. */
export const HOME_ZONE_RADIUS = 600;
export const MIN_STATION_SPACING = 800;
/** Chunk margin the station stays out of. */
export const STATION_MARGIN = 50;
/** Asteroids at least R + 30 from the station (spec 8.5), at least the layout's clearRadius. */
const STATION_CLEAR_MARGIN = 30;
const OUTPOST_SHARE = 0.5;
/** Chance of a station candidate in a chunk by the ring. */
const RING_STATION_CHANCE = [0.02, 0.012, 0.006, 0.003] as const;
/** Smooth blend of the chance around the ring boundaries (±10 %). */
const BLEND = 0.1;
/** How many chunks around are searched for stronger neighbours (4 × 200 ≥ spacing). */
const SPACING_CHUNKS = Math.ceil(MIN_STATION_SPACING / CHUNK_SIZE);
export const NAME_PREFIX_COUNT = 8;
export const NAME_STAR_COUNT = 8;

const STATION_SALT = 0x51a7_10e5;
const GUARANTEE_SALT = 0x6a2d_e1b3;

export function stationChance(distance: number): number {
  for (let i = 0; i < RINGS.length - 1; i++) {
    const boundary = RINGS[i]!.outer;
    const lo = boundary * (1 - BLEND);
    const hi = boundary * (1 + BLEND);
    if (distance < lo) return RING_STATION_CHANCE[i]!;
    if (distance < hi) {
      const t = (distance - lo) / (hi - lo);
      return RING_STATION_CHANCE[i]! * (1 - t) + RING_STATION_CHANCE[i + 1]! * t;
    }
  }
  return RING_STATION_CHANCE[RING_STATION_CHANCE.length - 1]!;
}

function layoutColliders(model: StationModel): Circle[] {
  return STATION_LAYOUTS[model].circles.map((c) => ({ pos: { x: c.x, y: c.y }, radius: c.r }));
}

const NEUTRAL_JITTER: Record<ResourceId, number> = { iron: 1, copper: 1, ice: 1, titanium: 1 };

export function homeStation(): StationDef {
  const model: StationModel = 'station_home';
  return {
    id: HOME_STATION_ID,
    kind: 'home',
    name: { prefix: 0, star: 0, number: null },
    pos: { x: 0, y: 0 },
    ring: 1,
    chunk: { cx: 0, cy: 0 },
    model,
    radius: STATION_LAYOUTS[model].radius,
    clearRadius: HOME_CLEAR_RADIUS,
    colliders: layoutColliders(model),
    portAngle: 0,
    services: STATION_SERVICES.home,
    priceJitter: { ...NEUTRAL_JITTER },
    variant: 0,
  };
}

interface Candidate {
  /** Smaller = stronger (home −2, guaranteed −1, else the roll). */
  priority: number;
  def: StationDef;
}

const clampToChunk = (v: number, c: number): number =>
  Math.min(Math.max(v, c * CHUNK_SIZE + STATION_MARGIN), (c + 1) * CHUNK_SIZE - STATION_MARGIN);

/** Target points of the guaranteed stations G1 (ring 1) and G2 (ring 2). */
/** The last seed's guaranteed targets (asked for by every candidate). */
let guaranteed: { seed: number; targets: [Vec2, Vec2] } | null = null;

function guaranteedTargets(seed: number): [Vec2, Vec2] {
  if (guaranteed?.seed === seed) return guaranteed.targets;
  const targets = computeGuaranteedTargets(seed);
  guaranteed = { seed, targets };
  return targets;
}

function computeGuaranteedTargets(seed: number): [Vec2, Vec2] {
  const rng = createRng(hash3(seed ^ GUARANTEE_SALT, 0, 0));
  const theta1 = rng() * TAU;
  const d1 = 900 + rng() * 300;
  const theta2 = theta1 + Math.PI + (rng() * 2 - 1) * (Math.PI / 3);
  const d2 = 2200 + rng() * 600;
  return [
    { x: Math.cos(theta1) * d1, y: Math.sin(theta1) * d1 },
    { x: Math.cos(theta2) * d2, y: Math.sin(theta2) * d2 },
  ];
}

/** Chunks of the guaranteed stations G1 and G2. */
export function guaranteedStationChunks(seed: number): [{ cx: number; cy: number }, { cx: number; cy: number }] {
  const [a, b] = guaranteedTargets(seed);
  return [
    { cx: chunkCoord(a.x), cy: chunkCoord(a.y) },
    { cx: chunkCoord(b.x), cy: chunkCoord(b.y) },
  ];
}

function makeDef(kind: StationKind, cx: number, cy: number, pos: Vec2, rest: () => number, numbered: boolean, gen: WorldGen): StationDef {
  // every value is always drawn, in a fixed order
  const portAngle = rest() * TAU;
  const variant = rest();
  const priceJitter = {} as Record<ResourceId, number>;
  for (const id of RESOURCE_IDS) priceJitter[id] = PRICE_JITTER_MIN + rest() * (PRICE_JITTER_MAX - PRICE_JITTER_MIN);
  const prefix = Math.floor(rest() * NAME_PREFIX_COUNT);
  const star = Math.floor(rest() * NAME_STAR_COUNT);
  const number = 2 + Math.floor(rest() * 98);
  const ring = ringIndexAt(length(pos));
  const model = gen >= 2 ? stationModelForRing(kind, variant, ring) : stationModelFor(kind, variant);
  const layout = STATION_LAYOUTS[model];
  return {
    id: `st:${cx},${cy}`,
    kind,
    name: { prefix, star, number: numbered ? number : null },
    pos,
    ring,
    chunk: { cx, cy },
    model,
    radius: layout.radius,
    clearRadius: Math.max(layout.clearRadius, layout.radius + STATION_CLEAR_MARGIN),
    colliders: layoutColliders(model),
    portAngle,
    services: STATION_SERVICES[kind],
    priceJitter,
    variant,
  };
}

/** The chunk's candidate before the spacing check (or null). */
function candidateAt(seed: number, cx: number, cy: number, gen: WorldGen): Candidate | null {
  if (cx === 0 && cy === 0) return { priority: -2, def: homeStation() };

  const rng = createRng(hash3(seed ^ STATION_SALT, cx, cy));
  const roll = rng();
  const px = cx * CHUNK_SIZE + STATION_MARGIN + rng() * (CHUNK_SIZE - 2 * STATION_MARGIN);
  const py = cy * CHUNK_SIZE + STATION_MARGIN + rng() * (CHUNK_SIZE - 2 * STATION_MARGIN);
  const outpost = rng() < OUTPOST_SHARE;

  const [g1, g2] = guaranteedTargets(seed);
  for (const g of [g1, g2]) {
    if (chunkCoord(g.x) !== cx || chunkCoord(g.y) !== cy) continue;
    const pos = { x: clampToChunk(g.x, cx), y: clampToChunk(g.y, cy) };
    return { priority: -1, def: makeDef('station', cx, cy, pos, rng, false, gen) };
  }

  const center = { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE };
  if (roll >= stationChance(length(center))) return null;
  const pos = { x: px, y: py };
  if (length(pos) < HOME_ZONE_RADIUS) return null;
  return { priority: roll, def: makeDef(outpost ? 'outpost' : 'station', cx, cy, pos, rng, true, gen) };
}

type CandidateLookup = (cx: number, cy: number) => Candidate | null;

function survives(c: Candidate, lookup: CandidateLookup): boolean {
  const { cx, cy } = c.def.chunk;
  for (let dx = -SPACING_CHUNKS; dx <= SPACING_CHUNKS; dx++) {
    for (let dy = -SPACING_CHUNKS; dy <= SPACING_CHUNKS; dy++) {
      if (dx === 0 && dy === 0) continue;
      const other = lookup(cx + dx, cy + dy);
      if (!other || other.priority >= c.priority) continue;
      const d = Math.hypot(other.def.pos.x - c.def.pos.x, other.def.pos.y - c.def.pos.y);
      if (d < MIN_STATION_SPACING) return false;
    }
  }
  return true;
}

function resolveStation(seed: number, cx: number, cy: number, lookup: CandidateLookup): StationDef | null {
  const c = lookup(cx, cy);
  return c && survives(c, lookup) ? c.def : null;
}

/**
 * The station in chunk (cx, cy), or null. A pure function of the hash. Positions, ids, names and the
 * kind never depend on `gen`; the model and the colliders do (the default is generation 1).
 */
/** Station answers per (seed, generator) and chunk – asked for every frame by the discovery and combat code. */
const stationMemo = new ChunkMemo<StationDef | null>();

/** A memo key for a seed and a small extra number, or null when the seed is no plain uint32. */
export const seedKey = (seed: number, extra: number, extraBits: number): number | null =>
  Number.isInteger(seed) && seed >= 0 && seed < 4_294_967_296 && Number.isInteger(extra) && extra >= 0 && extra < 2 ** extraBits ? seed * 2 ** extraBits + extra : null;

export function stationAt(seed: number, cx: number, cy: number, gen: WorldGen = WORLD_GEN_LEGACY): StationDef | null {
  const key = seedKey(seed, gen, 3);
  if (key !== null) {
    const known = stationMemo.get(key, cx, cy);
    if (known !== undefined) return known;
  }
  const s = resolveStation(seed, cx, cy, (x, y) => candidateAt(seed, x, y, gen));
  return key === null ? s : stationMemo.set(key, cx, cy, s);
}

/** Every station in a rectangle of chunks (borders included) – each candidate is computed once. */
export function stationsInArea(seed: number, cx0: number, cx1: number, cy0: number, cy1: number, gen: WorldGen = WORLD_GEN_LEGACY): StationDef[] {
  const memo = new Map<string, Candidate | null>();
  const lookup: CandidateLookup = (x, y) => {
    const key = `${x},${y}`;
    let c = memo.get(key);
    if (c === undefined) {
      c = candidateAt(seed, x, y, gen);
      memo.set(key, c);
    }
    return c;
  };
  const result: StationDef[] = [];
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const s = resolveStation(seed, cx, cy, lookup);
      if (s) result.push(s);
    }
  }
  return result;
}

export function stationById(seed: number, id: StationId, gen: WorldGen = WORLD_GEN_LEGACY): StationDef | null {
  if (id === HOME_STATION_ID) return homeStation();
  const match = /^st:(-?\d+),(-?\d+)$/.exec(id);
  if (!match) return null;
  return stationAt(seed, Number(match[1]), Number(match[2]), gen);
}

/**
 * The nearest discovered station; home is always discovered.
 * `resolve` lets the caller look the definitions up elsewhere first (e.g. in the active chunks).
 */
export function nearestDiscoveredStation(
  seed: number,
  discovered: Iterable<StationId>,
  pos: Vec2,
  resolve: (id: StationId) => StationDef | null = (id) => stationById(seed, id),
  /** Only stations passing this filter count (home is always the fallback). */
  accept: (s: StationDef) => boolean = () => true,
): StationDef {
  let best = homeStation();
  let bestDist = length(pos);
  for (const id of discovered) {
    if (id === HOME_STATION_ID) continue;
    const s = resolve(id);
    if (!s || !accept(s)) continue;
    const d = Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}
