// Space events M3.5b (5.5): ion storms and distress signals – pure functions of the seed, the place
// and the game time (like the sector state). Only the resolution of a distress signal is saved.
import type { RingIndex } from '../../data/economy';
import { DISTRESS, DISTRESS_KINDS, ION_STORM, type DistressKind } from '../../data/events';
import { TAU } from '../math/angle';
import { createRng } from '../math/rng';
import { hypot, length, type Vec2 } from '../math/vec2';
import { areaCenter, areaCoord, sectorAt, sectorEffects } from '../sector/sector';
import { CHUNK_SIZE, chunkCoord } from '../world/chunks';
import { hash3 } from '../world/hash';
import { ringIndexAt } from '../world/rings';
import { REGION_GEN } from '../regions/constants';
import { ChunkMemo } from '../world/chunkMemo';
import { seedKey, stationAt } from '../world/stations';

const STORM_SALT = 0x1057_04a7;
const DISTRESS_SALT = 0xd157_7e55;
const TICKS = 60;

export interface IonStorm {
  /** Steps of the storm's start and end. */
  start: number;
  end: number;
}

/** The rolls of one storm area and bucket (everything but the sector's multiplier). */
interface StormRoll {
  seed: number;
  ax: number;
  ay: number;
  bucket: number;
  ring: RingIndex;
  roll: number;
  /** The storm if it comes (shared, read-only). */
  storm: IonStorm;
}

/** The last few rolls (a step asks for the same area a few times: discovery, radar, director). */
const stormRolls: StormRoll[] = [];
const STORM_ROLLS_MAX = 4;

function stormRoll(seed: number, pos: Vec2, tick: number): StormRoll {
  const ax = areaCoord(pos.x);
  const ay = areaCoord(pos.y);
  const bucketTicks = ION_STORM.bucketSeconds * TICKS;
  const bucket = Math.floor(tick / bucketTicks);
  for (let i = 0; i < stormRolls.length; i++) {
    const r = stormRolls[i]!;
    if (r.seed === seed && r.ax === ax && r.ay === ay && r.bucket === bucket) return r;
  }
  const ring = ringIndexAt(length(areaCenter(ax, ay))) as RingIndex;
  const rng = createRng(hash3(hash3(seed ^ STORM_SALT, ax, ay), bucket, 0));
  const roll = rng();
  const dur = (ION_STORM.duration[0] + rng() * (ION_STORM.duration[1] - ION_STORM.duration[0])) * TICKS;
  const offset = rng() * Math.max(0, bucketTicks - dur);
  const start = Math.round(bucket * bucketTicks + offset);
  const r: StormRoll = { seed, ax, ay, bucket, ring, roll, storm: { start, end: Math.round(start + dur) } };
  if (stormRolls.length >= STORM_ROLLS_MAX) stormRolls.pop();
  stormRolls.unshift(r);
  return r;
}

/**
 * The ion storm in the area of a point in the given bucket (or null). Pure; the rolls of an area and
 * bucket are memoised (perf audit 2026-10-17, P4), so the answer is shared – read-only.
 */
export function ionStormIn(seed: number, pos: Vec2, tick: number): IonStorm | null {
  const r = stormRoll(seed, pos, tick);
  const mult = sectorEffects(sectorAt(seed, pos, tick)).ionStormMult;
  if (r.roll >= ION_STORM.chance[r.ring] * mult) return null;
  return r.storm;
}

/** Is an ion storm raging at the ship's place? */
export function ionStormAt(seed: number, pos: Vec2, tick: number): boolean {
  const s = ionStormIn(seed, pos, tick);
  return s !== null && tick >= s.start && tick < s.end;
}

// ---------------------------------------------------------------------------
// distress signals

export interface Distress {
  /** `ds:<cx>,<cy>@<bucket>` */
  id: string;
  kind: DistressKind;
  pos: Vec2;
  angle: number;
  /** Fuel for the stranded miner (units). */
  fuel: number;
  /** End of the bucket (step) – then the signal disappears. */
  until: number;
}

export const distressBucket = (tick: number): number => Math.floor(tick / (DISTRESS.bucketSeconds * TICKS));

/** Distress answers per (seed, bucket) and chunk – the scanner, the radio and the renderer ask every frame. */
const distressMemo = new ChunkMemo<Distress | null>();

export function distressAt(seed: number, cx: number, cy: number, bucket: number): Distress | null {
  const key = seedKey(seed, bucket, 20);
  if (key !== null) {
    const known = distressMemo.get(key, cx, cy);
    if (known !== undefined) return known;
  }
  const d = generateDistress(seed, cx, cy, bucket);
  return key === null ? d : distressMemo.set(key, cx, cy, d);
}

function generateDistress(seed: number, cx: number, cy: number, bucket: number): Distress | null {
  const center = { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE };
  if (length(center) < DISTRESS.homeClear) return null;
  const rng = createRng(hash3(hash3(seed ^ DISTRESS_SALT, cx, cy), bucket, 0));
  const roll = rng();
  const k = rng();
  const x = rng();
  const y = rng();
  const angle = rng() * TAU;
  const fuel = Math.round(DISTRESS.fuel[0] + rng() * (DISTRESS.fuel[1] - DISTRESS.fuel[0]));
  if (roll >= DISTRESS.chance[ringIndexAt(length(center))]) return null;
  const pos = { x: cx * CHUNK_SIZE + 30 + x * (CHUNK_SIZE - 60), y: cy * CHUNK_SIZE + 30 + y * (CHUNK_SIZE - 60) };
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const s = stationAt(seed, cx + dx, cy + dy);
    if (s && hypot(s.pos.x - pos.x, s.pos.y - pos.y) < s.clearRadius + 80) return null;
  }
  let r = k;
  let kind: DistressKind = 'fuel';
  for (const d of DISTRESS_KINDS) {
    r -= DISTRESS.weights[d];
    if (r < 0) {
      kind = d;
      break;
    }
  }
  // no pirate ambush this close to home (sectors §6.1): a trap there is a real ship in need of fuel
  if (kind === 'trap' && length(pos) < REGION_GEN.corner.pirateFreeRadius) kind = 'fuel';
  return { id: `ds:${cx},${cy}@${bucket}`, kind, pos, angle, fuel, until: (bucket + 1) * DISTRESS.bucketSeconds * TICKS };
}

/** Active distress signals within `radius` of a point. */
export function distressNear(seed: number, pos: Vec2, radius: number, tick: number): Distress[] {
  const bucket = distressBucket(tick);
  const out: Distress[] = [];
  const x0 = chunkCoord(pos.x - radius);
  const x1 = chunkCoord(pos.x + radius);
  const y0 = chunkCoord(pos.y - radius);
  const y1 = chunkCoord(pos.y + radius);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const d = distressAt(seed, cx, cy, bucket);
      if (d && hypot(d.pos.x - pos.x, d.pos.y - pos.y) <= radius) out.push(d);
    }
  }
  return out;
}

/** A signal by id (also from another bucket – for a saved trap), or null. */
export function distressById(seed: number, id: string): Distress | null {
  const m = /^ds:(-?\d+),(-?\d+)@(\d+)$/.exec(id);
  return m ? distressAt(seed, Number(m[1]), Number(m[2]), Number(m[3])) : null;
}
